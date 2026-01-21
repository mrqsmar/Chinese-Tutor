import AsyncStorage from "@react-native-async-storage/async-storage";
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

const API_URL = "http://172.16.0.29:8000";
const STORAGE_KEY = "speakerPreference";
const TYPING_INTERVAL_MS = 18;

const createId = () => Math.random().toString(36).slice(2, 10);

type SpeakerPreference = "english" | "chinese";

type DeepSeekMessage = {
  role: "user" | "assistant";
  content: string;
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
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: createId(),
      role: "assistant",
      text: "你好！我是你的中文导师。我们开始吧！",
    },
  ]);
  const [input, setInput] = useState("");
  const [preference, setPreference] = useState<SpeakerPreference | null>(null);
  const [isLoadingPreference, setIsLoadingPreference] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

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

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speaker: preference,
          messages: conversation.map<DeepSeekMessage>((message) => ({
            role: message.role,
            content: message.text,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch response");
      }

      const data = (await response.json()) as { reply: string };
      const assistantId = createId();

      setMessages((prev) =>
        prev
          .filter((message) => !message.isTyping)
          .concat({ id: assistantId, role: "assistant", text: "" })
      );

      streamAssistantResponse(assistantId, data.reply);
    } catch (error) {
      setMessages((prev) =>
        prev
          .filter((message) => !message.isTyping)
          .concat({
            id: createId(),
            role: "assistant",
            text: "抱歉，暂时无法连接到服务器。请稍后再试。",
          })
      );
    } finally {
      setIsSending(false);
    }
  };

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
