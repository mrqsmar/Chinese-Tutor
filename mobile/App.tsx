import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import type { ChatMessage } from "./src/types/chat";

const API_URL = "https://uncircuitous-tuan-legibly.ngrok-free.dev";
const STORAGE_KEY = "speakerPreference";
const TYPING_INTERVAL_MS = 18;

const createId = () => Math.random().toString(36).slice(2, 10);

type SpeakerPreference = "english" | "chinese";
type MicPermissionState = "undetermined" | "granted" | "denied";

type SpeechTurnAudio = {
  format: "mp3" | "wav";
  url?: string;
  base64?: string;
};

type SpeechTurnResponse = {
  transcript: string;
  normalized_request: string;
  chinese: string;
  pinyin: string;
  notes: string[];
  audio: SpeechTurnAudio;
};


const Onboarding = ({
  onSelect,
}: {
  onSelect: (preference: SpeakerPreference) => void;
}) => {
  return (
    <SafeAreaView style={styles.onboardingContainer}>
      <View style={styles.onboardingCard}>
        <Text style={styles.onboardingTitle}>Welcome</Text>
        <Text style={styles.onboardingSubtitle}>
          Are you an English speaker or Chinese speaker?
        </Text>
        <View style={styles.onboardingButtons}>
          <TouchableOpacity
            style={styles.onboardingButton}
            onPress={() => onSelect("english")}
          >
            <Text style={styles.onboardingButtonText}>English Speaker</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.onboardingButton, styles.onboardingButtonSecondary]}
            onPress={() => onSelect("chinese")}
          >
            <Text style={styles.onboardingButtonText}>Chinese Speaker</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [preference, setPreference] = useState<SpeakerPreference | null>(null);
  const [isLoadingPreference, setIsLoadingPreference] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micPermission, setMicPermission] =
    useState<MicPermissionState>("undetermined");
  const [isRecording, setIsRecording] = useState(false);
  const [isUploadingVoice, setIsUploadingVoice] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceTurn, setVoiceTurn] = useState<SpeechTurnResponse | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    const loadPreference = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored === "english" || stored === "chinese") {
          setPreference(stored);
        }
      } finally {
        setIsLoadingPreference(false);
      }
    };

    loadPreference();
  }, []);

  const handleSelectPreference = async (selection: SpeakerPreference) => {
    setPreference(selection);
    await AsyncStorage.setItem(STORAGE_KEY, selection);
  };

  const systemHint = useMemo(() => {
    if (preference === "english") {
      return "Explain in English, include Chinese + pinyin.";
    }
    if (preference === "chinese") {
      return "Explain in Chinese, include English + pronunciation tips.";
    }
    return "";
  }, [preference]);

  const welcomeMessage = useMemo(() => {
    if (preference === "english") {
      return "Hi! I’m your Chinese tutor. Say hello or tell me what you want to practice.";
    }
    if (preference === "chinese") {
      return "你好！我是你的中文老师。跟我打个招呼，或者告诉我你想练什么。";
    }
    return "";
  }, [preference]);

  useEffect(() => {
    if (!preference || messages.length > 0) {
      return;
    }

    setMessages([
      {
        id: createId(),
        role: "assistant",
        text: welcomeMessage,
      },
    ]);
  }, [messages.length, preference, welcomeMessage]);

  const streamAssistantResponse = useCallback(
    (messageId: string, fullText: string) => {
      let index = 0;
      const interval = setInterval(() => {
        index += 1;
        setMessages((prev) =>
          prev.map((message) =>
            message.id === messageId
              ? { ...message, text: fullText.slice(0, index) }
              : message
          )
        );
        if (index >= fullText.length) {
          clearInterval(interval);
        }
      }, TYPING_INTERVAL_MS);
    },
    []
  );

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending || !preference) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      text: trimmed,
    };

    const typingMessage: ChatMessage = {
      id: createId(),
      role: "assistant",
      text: "",
      isTyping: true,
    };

    const conversation = [...messages, userMessage];

    setMessages([...conversation, typingMessage]);
    setInput("");
    setIsSending(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speaker: preference, // "english" | "chinese"
          messages: conversation.map((m) => ({
            role: m.role,       // "user" | "assistant"
            content: m.text,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch response");
      }

      const data = (await response.json()) as { reply: string };
      const assistantId = createId();

      setError(null);
      setMessages((prev) =>
        prev
          .filter((message) => !message.isTyping)
          .concat({ id: assistantId, role: "assistant", text: "" })
      );

      streamAssistantResponse(assistantId, data.reply);
    } catch (error) {
      setError("抱歉，暂时无法连接到服务器。请稍后再试。");
      setMessages((prev) =>
        prev.filter((message) => !message.isTyping)
      );
    } finally {
      setIsSending(false);
    }
  };

  const ensureMicPermission = async () => {
    if (micPermission === "granted") {
      return true;
    }
    const permission = await Audio.requestPermissionsAsync();
    if (permission.granted) {
      setMicPermission("granted");
      return true;
    }
    setMicPermission("denied");
    return false;
  };

  const playVoiceAudio = async (audio: SpeechTurnAudio) => {
    const uri =
      audio.url ?? `data:audio/${audio.format};base64,${audio.base64}`;
    if (!uri) {
      return;
    }
    if (soundRef.current) {
      await soundRef.current.unloadAsync();
    }
    const sound = new Audio.Sound();
    await sound.loadAsync({ uri });
    await sound.playAsync();
    soundRef.current = sound;
  };

  const startRecording = async () => {
    if (isRecording || isUploadingVoice) {
      return;
    }
    const hasPermission = await ensureMicPermission();
    if (!hasPermission) {
      setVoiceError(
        "Microphone access is required. Please enable it in system settings."
      );
      return;
    }
    setVoiceError(null);
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
    const recording = new Audio.Recording();
    await recording.prepareToRecordAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );
    await recording.startAsync();
    recordingRef.current = recording;
    setIsRecording(true);
  };

  const stopRecording = async () => {
    const recording = recordingRef.current;
    if (!recording) {
      return;
    }
    setIsRecording(false);
    setIsUploadingVoice(true);
    setVoiceError(null);
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;
      if (!uri) {
        throw new Error("Missing recording URI");
      }
      const formData = new FormData();
      formData.append("audio_file", {
        uri,
        name: "speech.m4a",
        type: "audio/m4a",
      } as unknown as Blob);
      formData.append("source_lang", "en");
      formData.append("target_lang", "zh");
      formData.append("scenario", "restaurant");

      const response = await fetch(`${API_URL}/v1/speech/turn`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to fetch speech response");
      }

      const data = (await response.json()) as SpeechTurnResponse;
      setVoiceTurn(data);
      await playVoiceAudio(data.audio);
    } catch (voiceUploadError) {
      setVoiceError("Voice request failed. Please try again.");
    } finally {
      setIsUploadingVoice(false);
    }
  };

  useEffect(() => {
    return () => {
      if (soundRef.current) {
        void soundRef.current.unloadAsync();
      }
      if (recordingRef.current) {
        void recordingRef.current.stopAndUnloadAsync();
      }
    };
  }, []);

  const renderItem = ({ item }: { item: ChatMessage }) => (
    <View
      style={[
        styles.messageBubble,
        item.role === "user" ? styles.userBubble : styles.botBubble,
      ]}
    >
      {item.isTyping ? (
        <View style={styles.typingRow}>
          <ActivityIndicator size="small" color="#6A6A6A" />
          <Text style={styles.typingText}>Typing...</Text>
        </View>
      ) : (
        <Text style={item.role === "user" ? styles.userText : styles.botText}>
          {item.text}
        </Text>
      )}
    </View>
  );

  if (isLoadingPreference) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2F6FED" />
      </SafeAreaView>
    );
  }

  if (!preference) {
    return <Onboarding onSelect={handleSelectPreference} />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Chinese Tutor</Text>
          <Text style={styles.subtitle}>{systemHint}</Text>
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.voiceCard}>
          <Text style={styles.voiceTitle}>Voice Turn</Text>
          <Text style={styles.voiceSubtitle}>
            Hold the button, speak English, release to translate.
          </Text>
          {micPermission === "denied" ? (
            <Text style={styles.voiceError}>
              Microphone access is disabled. Enable it in system settings.
            </Text>
          ) : null}
          {voiceError ? (
            <Text style={styles.voiceError}>{voiceError}</Text>
          ) : null}
          <TouchableOpacity
            style={[
              styles.voiceButton,
              isRecording && styles.voiceButtonActive,
              (isUploadingVoice || micPermission === "denied") &&
                styles.voiceButtonDisabled,
            ]}
            onPressIn={startRecording}
            onPressOut={stopRecording}
            disabled={isUploadingVoice || micPermission === "denied"}
          >
            <Text style={styles.voiceButtonText}>
              {isRecording
                ? "Recording..."
                : isUploadingVoice
                ? "Processing..."
                : "Hold to Talk"}
            </Text>
          </TouchableOpacity>
          {voiceTurn ? (
            <View style={styles.voiceResult}>
              <Text style={styles.voiceLabel}>Transcript</Text>
              <Text style={styles.voiceValue}>{voiceTurn.transcript}</Text>
              <Text style={styles.voiceLabel}>Chinese</Text>
              <Text style={styles.voiceValue}>{voiceTurn.chinese}</Text>
              <Text style={styles.voiceLabel}>Pinyin</Text>
              <Text style={styles.voiceValue}>{voiceTurn.pinyin}</Text>
            </View>
          ) : null}
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.messagesContent}
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: true })
          }
        />

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder="Type in English, 中文, or both"
            value={input}
            onChangeText={setInput}
            editable={!isSending}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendButton, isSending && styles.sendButtonDisabled]}
            onPress={sendMessage}
            disabled={isSending}
          >
            <Text style={styles.sendButtonText}>
              {isSending ? "..." : "Send"}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  keyboardAvoid: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1F1F1F",
  },
  subtitle: {
    marginTop: 6,
    fontSize: 12,
    color: "#7A7A7A",
  },
  messagesContent: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  messageBubble: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    maxWidth: "85%",
  },
  userBubble: {
    backgroundColor: "#2F6FED",
    alignSelf: "flex-end",
  },
  botBubble: {
    backgroundColor: "#F6F6F6",
    alignSelf: "flex-start",
  },
  userText: {
    color: "#FFFFFF",
    fontSize: 14,
  },
  botText: {
    color: "#1F1F1F",
    fontSize: 14,
  },
  typingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  typingText: {
    marginLeft: 8,
    color: "#6A6A6A",
    fontSize: 12,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#F0F0F0",
  },
  input: {
    flex: 1,
    backgroundColor: "#F7F7F7",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    maxHeight: 120,
  },
  sendButton: {
    marginLeft: 10,
    backgroundColor: "#2F6FED",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
  },
  sendButtonDisabled: {
    backgroundColor: "#9BB6F5",
  },
  sendButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 14,
  },
  errorBanner: {
    backgroundColor: "#FEE2E2",
    borderBottomWidth: 1,
    borderBottomColor: "#FECACA",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorText: {
    color: "#B91C1C",
    fontSize: 12,
  },
  voiceCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  voiceTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  voiceSubtitle: {
    marginTop: 6,
    fontSize: 12,
    color: "#6B7280",
  },
  voiceError: {
    marginTop: 8,
    fontSize: 12,
    color: "#B91C1C",
  },
  voiceButton: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: "#2F6FED",
    alignItems: "center",
  },
  voiceButtonActive: {
    backgroundColor: "#1D4ED8",
  },
  voiceButtonDisabled: {
    backgroundColor: "#94A3B8",
  },
  voiceButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 14,
  },
  voiceResult: {
    marginTop: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 12,
  },
  voiceLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6B7280",
    textTransform: "uppercase",
    marginTop: 8,
  },
  voiceValue: {
    marginTop: 4,
    fontSize: 14,
    color: "#111827",
  },
  onboardingContainer: {
    flex: 1,
    backgroundColor: "#F5F7FB",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  onboardingCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 420,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  onboardingTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1F1F1F",
  },
  onboardingSubtitle: {
    marginTop: 10,
    fontSize: 14,
    color: "#5A5A5A",
  },
  onboardingButtons: {
    marginTop: 20,
  },
  onboardingButton: {
    backgroundColor: "#2F6FED",
    paddingVertical: 12,
    borderRadius: 18,
    alignItems: "center",
    marginBottom: 12,
  },
  onboardingButtonSecondary: {
    backgroundColor: "#111827",
  },
  onboardingButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 14,
  },
});
