import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
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

import LockScreen from "./src/components/LockScreen";
import {
  clearUnlock,
  hasValidUnlock,
  persistUnlock,
} from "./src/config/appLock";
import type { ChatMessage } from "./src/types/chat";
import { API_BASE_URL, logApiBaseUrl } from "./src/config/api";

const STORAGE_KEY = "speakerPreference";
const TYPING_INTERVAL_MS = 18;

const createId = () => Math.random().toString(36).slice(2, 10);

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const fetchWithTimeout = async (
  url: string,
  options: RequestInit,
  timeoutMs: number,
  retryCount: number
) => {
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return { response, durationMs: Date.now() - startedAt };
    } catch (error) {
      clearTimeout(timeoutId);
      const isTimeout =
        error instanceof Error && error.name === "AbortError";
      if (!isTimeout || attempt >= retryCount) {
        throw error;
      }
      console.warn("Request timed out, retrying...");
      await wait(1000);
    }
  }
  throw new Error("Request timed out.");
};

type SpeakerPreference = "english" | "chinese";
type MicPermissionState = "undetermined" | "granted" | "denied";

type SpeechTurnAudio = {
  format: "mp3" | "wav";
  url?: string;
  base64?: string;
};

type SpeechTurnResponse = {
  assistant_text: string;
  transcript: string;
  normalized_request: string;
  chinese: string;
  pinyin: string;
  notes: string[];
  audio?: SpeechTurnAudio | null;
  audio_url?: string | null;
  audio_base64?: string | null;
  audio_mime?: string | null;
  audio_job_id?: string | null;
  audio_pending?: boolean | null;
  tts_error?: string | null;
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
  const [isAppUnlocked, setIsAppUnlocked] = useState(false);
  const [isLoadingAppLock, setIsLoadingAppLock] = useState(true);
  const [isUnlocking, setIsUnlocking] = useState(false);
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
    logApiBaseUrl("App start");
    const loadAppLock = async () => {
      const unlocked = await hasValidUnlock();
      setIsAppUnlocked(unlocked);
      setIsLoadingAppLock(false);
    };

    loadAppLock();
  }, []);

  useEffect(() => {
    if (!isAppUnlocked) {
      return;
    }

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
  }, [isAppUnlocked]);

  const handleUnlock = async () => {
    setIsUnlocking(true);
    try {
      await persistUnlock();
      setIsAppUnlocked(true);
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleLock = async () => {
    await clearUnlock();
    setIsAppUnlocked(false);
  };

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
      logApiBaseUrl("Chat request");
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
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

  const createAudioFileUri = async (
    audio: SpeechTurnAudio,
    audioMime?: string | null
  ) => {
    if (audio.url) {
      return audio.url;
    }
    if (!audio.base64) {
      return null;
    }
    const extension =
      audioMime?.includes("mpeg") || audio.format === "mp3" ? "mp3" : "wav";
    const fileUri = `${FileSystem.cacheDirectory}tts-${Date.now()}.${extension}`;
    await FileSystem.writeAsStringAsync(fileUri, audio.base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return fileUri;
  };

  const playVoiceAudio = async (
    audio: SpeechTurnAudio,
    audioMime?: string | null
  ) => {
    const uri = await createAudioFileUri(audio, audioMime);
    if (!uri) {
      throw new Error("No audio URL or base64 provided.");
    }
    console.log("Voice audio URI:", uri);
    if (soundRef.current) {
      await soundRef.current.unloadAsync();
    }
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });
    const sound = new Audio.Sound();
    sound.setOnPlaybackStatusUpdate((status) => {
      console.log("Voice playback status:", status);
    });
    await sound.loadAsync({ uri });
    await sound.playAsync();
    soundRef.current = sound;
  };

  const pollForAudioJob = async (jobId: string) => {
    const maxAttempts = 10;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      logApiBaseUrl(`Audio poll attempt ${attempt}`);
      const { response } = await fetchWithTimeout(
        `${API_BASE_URL}/v1/speech/audio/${jobId}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
        },
        30_000,
        0
      );
      const raw = await response.text();
      console.log("Audio poll status:", response.status);
      console.log("Audio poll response:", raw.slice(0, 500));
      if (!response.ok) {
        setVoiceError("Audio fetch failed. Please try again.");
        return;
      }
      const data = JSON.parse(raw) as {
        status: "pending" | "ready" | "error";
        audio_url?: string | null;
        audio_base64?: string | null;
        audio_mime?: string | null;
        tts_error?: string | null;
      };
      if (data.status === "ready") {
        const audioPayload = {
          format: data.audio_mime?.includes("mpeg") ? "mp3" : "wav",
          url: data.audio_url ?? undefined,
          base64: data.audio_base64 ?? undefined,
        };
        if (audioPayload.url || audioPayload.base64) {
          await playVoiceAudio(audioPayload, data.audio_mime ?? undefined);
          return;
        }
        setVoiceError("Audio unavailable. Please try again.");
        return;
      }
      if (data.status === "error") {
        setVoiceError(data.tts_error ?? "Audio failed. Please try again.");
        return;
      }
      await wait(1000);
    }
    setVoiceError("Audio is taking too long. Please try again.");
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
      const status = await recording.getStatusAsync();
      const uri = recording.getURI();
      recordingRef.current = null;
      if (!uri) {
        throw new Error("Missing recording URI");
      }
      const fileInfo = await FileSystem.getInfoAsync(uri, { size: true });
      console.log("Voice recording duration (ms):", status.durationMillis);
      console.log("Voice recording file size (bytes):", fileInfo.size);
      const formData = new FormData();
      formData.append("audio", {
        uri,
        name: "speech.m4a",
        type: "audio/mp4",
      } as any);
      formData.append("level", "beginner");
      formData.append("scenario", "restaurant");
      formData.append("source_lang", "en");
      formData.append("target_lang", "zh");

      logApiBaseUrl("Voice upload");
      const { response, durationMs } = await fetchWithTimeout(
        `${API_BASE_URL}/v1/speech/turn`,
        {
          method: "POST",
          headers: { Accept: "application/json" },
          body: formData,
        },
        90_000,
        1
      );

      const raw = await response.text();
      console.log("Voice request duration (ms):", durationMs);
      console.log("Voice Status:", response.status);
      console.log("Voice Response Raw:", raw.slice(0, 500));
      console.log("Voice Response Raw:", raw);
      if (!response.ok) {
        throw new Error(`Voice failed ${response.status}: ${raw}`);
      }

      const data = JSON.parse(raw) as SpeechTurnResponse;
      console.log("Voice Response Payload:", data);
      setVoiceTurn(data);
      const audioPayload = data.audio ?? {
        format: data.audio_mime?.includes("mpeg") ? "mp3" : "wav",
        url: data.audio_url ?? undefined,
        base64: data.audio_base64 ?? undefined,
      };
      if (audioPayload.url || audioPayload.base64) {
        try {
          await playVoiceAudio(audioPayload, data.audio_mime);
        } catch (playbackError) {
          console.error("Voice playback error:", playbackError);
          setVoiceError(
            "Audio playback failed. Please check your volume and try again."
          );
        }
      } else if (data.audio_pending && data.audio_job_id) {
        await pollForAudioJob(data.audio_job_id);
      } else if (!data.tts_error) {
        setVoiceError("Audio unavailable. Please try again.");
      }
    } catch (voiceUploadError) {
      console.error("Voice upload error:", voiceUploadError);
      const isTimeout =
        voiceUploadError instanceof Error &&
        (voiceUploadError.name === "AbortError" ||
          voiceUploadError.message.toLowerCase().includes("timed out"));
      setVoiceError(
        isTimeout
          ? "Voice request timed out. Please try again."
          : "Voice request failed. Please try again."
      );
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

  if (isLoadingAppLock) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2F6FED" />
      </SafeAreaView>
    );
  }

  if (!isAppUnlocked) {
    return <LockScreen onUnlock={handleUnlock} isSubmitting={isUnlocking} />;
  }

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
          <Text style={styles.title} onLongPress={handleLock}>
            Chinese Tutor
          </Text>
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
              {voiceTurn.tts_error ? (
                <Text style={styles.voiceAudioNote}>Audio unavailable</Text>
              ) : null}
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
  voiceAudioNote: {
    marginTop: 8,
    fontSize: 12,
    color: "#6B7280",
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
