import { useMemo, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import TeachingCard from "./src/components/TeachingCard";
import type { ChatMessage, Teaching } from "./src/types/chat";

const API_URL = "http://localhost:8000";

const createId = () => Math.random().toString(36).slice(2, 10);

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: createId(),
      role: "assistant",
      text: "你好！我是你的中文导师。我们开始吧！",
    },
  ]);
  const [input, setInput] = useState("");
  const [level, setLevel] = useState<"beginner" | "intermediate">("beginner");
  const [isSending, setIsSending] = useState(false);

  const levelLabel = useMemo(
    () => (level === "beginner" ? "Beginner" : "Intermediate"),
    [level]
  );

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      text: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, level }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch response");
      }

      const data = (await response.json()) as { reply: string; teaching: Teaching };
      const assistantMessage: ChatMessage = {
        id: createId(),
        role: "assistant",
        text: data.reply,
        teaching: data.teaching,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const assistantMessage: ChatMessage = {
        id: createId(),
        role: "assistant",
        text: "抱歉，暂时无法连接到服务器。请稍后再试。",
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Chinese Tutor</Text>
        <View style={styles.levelContainer}>
          <Text style={styles.levelLabel}>Level</Text>
          <View style={styles.levelButtons}>
            {(["beginner", "intermediate"] as const).map((option) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.levelButton,
                  option === level && styles.levelButtonActive,
                ]}
                onPress={() => setLevel(option)}
              >
                <Text
                  style={[
                    styles.levelButtonText,
                    option === level && styles.levelButtonTextActive,
                  ]}
                >
                  {option === "beginner" ? "Beginner" : "Intermediate"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.levelHelper}>{levelLabel} mode</Text>
        </View>
      </View>

      <ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent}>
        {messages.map((message) => (
          <View
            key={message.id}
            style={[
              styles.messageBubble,
              message.role === "user" ? styles.userBubble : styles.botBubble,
            ]}
          >
            <Text
              style={
                message.role === "user" ? styles.userText : styles.botText
              }
            >
              {message.text}
            </Text>
            {message.teaching && <TeachingCard teaching={message.teaching} />}
          </View>
        ))}
      </ScrollView>

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Type in English, 中文, or both"
          value={input}
          onChangeText={setInput}
          editable={!isSending}
        />
        <TouchableOpacity
          style={[styles.sendButton, isSending && styles.sendButtonDisabled]}
          onPress={sendMessage}
          disabled={isSending}
        >
          <Text style={styles.sendButtonText}>{isSending ? "..." : "Send"}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
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
  levelContainer: {
    marginTop: 12,
  },
  levelLabel: {
    fontSize: 12,
    color: "#6A6A6A",
    marginBottom: 6,
  },
  levelButtons: {
    flexDirection: "row",
  },
  levelButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#D0D0D0",
    marginRight: 8,
  },
  levelButtonActive: {
    backgroundColor: "#2F6FED",
    borderColor: "#2F6FED",
  },
  levelButtonText: {
    fontSize: 12,
    color: "#4A4A4A",
  },
  levelButtonTextActive: {
    color: "#FFFFFF",
  },
  levelHelper: {
    marginTop: 6,
    fontSize: 12,
    color: "#7A7A7A",
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  messageBubble: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
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
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
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
});
