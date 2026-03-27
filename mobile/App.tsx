import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  NativeSyntheticEvent,
  Animated,
  Easing,
  FlatList,
  TextInputKeyPressEventData,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import ApiBlockedScreen from "./src/components/ApiBlockedScreen";
import AuthScreen from "./src/components/AuthScreen";
import LockScreen from "./src/components/LockScreen";
import StructuredLearningCard, {
  MultiCardGroup,
  parseMultipleCards,
} from "./src/components/StructuredLearningCard";
import VoiceStage, { type VoiceStageState } from "./src/components/VoiceStage";
import {
  clearUnlock,
  hasValidUnlock,
  persistUnlock,
} from "./src/config/appLock";
import type { ChatMessage } from "./src/types/chat";
import { assertApiBaseUrl, logApiBaseUrl } from "./src/config/api";
import { apiFetch, apiFetchWithTimeout } from "./src/config/apiClient";
import { login, logout, refreshSession } from "./src/config/auth";

const STORAGE_KEY = "speakerPreference";
const TYPING_INTERVAL_MS = 18;

const isTruthy = (value: string | undefined) =>
  ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase());

const DEMO_MODE = isTruthy(process.env.EXPO_PUBLIC_DEMO_MODE);
const CHATBOT_ONLY_MODE = isTruthy(
  process.env.EXPO_PUBLIC_CHATBOT_ONLY_MODE
);
const REQUIRE_AUTH =
  isTruthy(process.env.EXPO_PUBLIC_REQUIRE_AUTH) &&
  process.env.NODE_ENV === "production";

const createId = () => Math.random().toString(36).slice(2, 10);

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

type SpeakerPreference = "english" | "chinese";
type MicPermissionState = "undetermined" | "granted" | "denied";
type VoiceOption = "warm" | "bright" | "deep";
type ModeTheme = {
  gradientTop: string;
  gradientBottom: string;
  blobPrimary: string;
  blobSecondary: string;
  headerSurface: string;
  headerGlow: string;
  headerAccentTrack: string;
  headerAccentLine: string;
  surfaceTint: string;
  surfaceBorder: string;
  titleText: string;
  subtitleText: string;
  voiceLabelText: string;
  voiceSupportText: string;
  inputBarBackground: string;
  inputBarBorder: string;
  composerBackground: string;
  composerBorder: string;
  inputText: string;
  inputPlaceholder: string;
  sendButtonBackground: string;
  sendButtonBorder: string;
  sendButtonText: string;
  userMessageBackground: string;
  userMessageBorder: string;
  userMessageText: string;
  messageAccentText: string;
};

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

const TypingIndicator = () => {
  const dotAnims = useRef([
    new Animated.Value(0.35),
    new Animated.Value(0.35),
    new Animated.Value(0.35),
  ]).current;

  useEffect(() => {
    const loops = dotAnims.map((anim, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 140),
          Animated.timing(anim, {
            toValue: 1,
            duration: 220,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.35,
            duration: 220,
            useNativeDriver: true,
          }),
        ])
      )
    );

    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [dotAnims]);

  return (
    <View style={styles.typingDotsRow}>
      {dotAnims.map((anim, index) => (
        <Animated.View
          key={index}
          style={[
            styles.typingDot,
            {
              opacity: anim,
              transform: [
                {
                  translateY: anim.interpolate({
                    inputRange: [0.35, 1],
                    outputRange: [0, -2],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
      <Text style={styles.typingText}>Translating your phrase...</Text>
    </View>
  );
};

const LoadingState = ({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) => (
  <SafeAreaView style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#A16207" />
    <Text style={styles.loadingTitle}>{title}</Text>
    <Text style={styles.loadingSubtitle}>{subtitle}</Text>
  </SafeAreaView>
);

const EmptyChatState = ({ preference }: { preference: SpeakerPreference }) => (
  <View style={styles.emptyStateCard}>
    <Text style={styles.emptyStateEyebrow}>
      {preference === "chinese" ? "开始学习" : "Start learning"}
    </Text>
    <Text style={styles.emptyStateTitle}>
      {preference === "chinese"
        ? "说一句中文，或者打一句话。"
        : "Say one phrase out loud or type one."}
    </Text>
    <Text style={styles.emptyStateBody}>
      {preference === "chinese"
        ? '试试：”你好是什么意思？”或”1、2、3用英文怎么说？”'
        : "Try: \"How do I say nice to meet you?\" or \"1, 2, 3 in Chinese.\""}
    </Text>
  </View>
);

const MessageBubble = ({
  item,
  theme,
  preference,
  onSuggestionPress,
}: {
  item: ChatMessage;
  theme: ModeTheme;
  preference: "english" | "chinese" | null;
  onSuggestionPress: (text: string) => void;
}) => {
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
      easing: Easing.out(Easing.cubic),
    }).start();
  }, [entrance]);

  return (
    <Animated.View
      style={[
        styles.messageBubble,
        item.role === "user" ? styles.userBubble : styles.botBubble,
        item.role === "user"
          ? {
              backgroundColor: theme.userMessageBackground,
              borderColor: theme.userMessageBorder,
            }
          : null,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [10, 0],
              }),
            },
          ],
        },
      ]}
    >
      {item.isTyping ? (
        <TypingIndicator />
      ) : item.role === "assistant" ? (() => {
          const cards = parseMultipleCards(item.text);
          const mode = preference ?? "english";
          if (cards.length > 1) {
            return (
              <MultiCardGroup
                cards={cards}
                mode={mode}
                onSuggestionPress={onSuggestionPress}
              />
            );
          }
          return (
            <StructuredLearningCard
              {...cards[0]}
              mode={mode}
              onSuggestionPress={onSuggestionPress}
            />
          );
        })() : (
        <Text
          style={[
            item.role === "user" ? styles.userText : styles.botText,
            item.role === "user"
              ? { color: theme.userMessageText }
              : { color: theme.messageAccentText },
          ]}
        >
          {item.text}
        </Text>
      )}
    </Animated.View>
  );
};

const useMicroButton = () => {
  const scale = useRef(new Animated.Value(1)).current;
  const brightness = useRef(new Animated.Value(0)).current;

  const animateTo = useCallback((toScale: number, toBrightness: number) => {
    Animated.parallel([
      Animated.timing(scale, {
        toValue: toScale,
        duration: 140,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(brightness, {
        toValue: toBrightness,
        duration: 160,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start();
  }, [brightness, scale]);

  return {
    style: {
      transform: [{ scale }],
      opacity: brightness.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0.92],
      }),
    },
    handlers: {
      onPressIn: () => animateTo(0.97, 1),
      onPressOut: () => animateTo(1, 0),
      onHoverIn: () => animateTo(1.02, 0),
      onHoverOut: () => animateTo(1, 0),
    },
  };
};

const MODE_THEMES: Record<VoiceOption, ModeTheme> = {
  warm: {
    gradientTop: "#FFF8EE",
    gradientBottom: "#FFEFE3",
    blobPrimary: "rgba(251, 146, 120, 0.24)",
    blobSecondary: "rgba(253, 186, 116, 0.2)",
    headerSurface: "rgba(255, 249, 239, 0.68)",
    headerGlow: "rgba(251, 191, 36, 0.12)",
    headerAccentTrack: "rgba(194, 65, 12, 0.1)",
    headerAccentLine: "rgba(234, 88, 12, 0.45)",
    surfaceTint: "#FFEDD5",
    surfaceBorder: "#FDBA74",
    titleText: "#6B2C12",
    subtitleText: "#9A5A2B",
    voiceLabelText: "#9A3412",
    voiceSupportText: "#92400E",
    inputBarBackground: "#F9F2E8",
    inputBarBorder: "#EEDCC7",
    composerBackground: "#FFFDF9",
    composerBorder: "#E7DAC8",
    inputText: "#4A2F1A",
    inputPlaceholder: "#A48768",
    sendButtonBackground: "#8F5A33",
    sendButtonBorder: "#7B4925",
    sendButtonText: "#FFFFFF",
    userMessageBackground: "#FFF7ED",
    userMessageBorder: "#FCD9B1",
    userMessageText: "#7C2D12",
    messageAccentText: "#B45309",
  },
  bright: {
    gradientTop: "#F7FCFF",
    gradientBottom: "#EAF6FF",
    blobPrimary: "rgba(125, 211, 252, 0.2)",
    blobSecondary: "rgba(103, 232, 249, 0.18)",
    headerSurface: "rgba(245, 252, 255, 0.7)",
    headerGlow: "rgba(56, 189, 248, 0.14)",
    headerAccentTrack: "rgba(14, 165, 233, 0.12)",
    headerAccentLine: "rgba(2, 132, 199, 0.42)",
    surfaceTint: "#ECFEFF",
    surfaceBorder: "#A5F3FC",
    titleText: "#0F3A56",
    subtitleText: "#356281",
    voiceLabelText: "#0C4A6E",
    voiceSupportText: "#1E5B7D",
    inputBarBackground: "#EBF4FF",
    inputBarBorder: "#BAD4F5",
    composerBackground: "#F8FCFF",
    composerBorder: "#BFDBFE",
    inputText: "#12344A",
    inputPlaceholder: "#6892AC",
    sendButtonBackground: "#0369A1",
    sendButtonBorder: "#075985",
    sendButtonText: "#FFFFFF",
    userMessageBackground: "#EAF7FF",
    userMessageBorder: "#BAE6FD",
    userMessageText: "#0C4A6E",
    messageAccentText: "#0284C7",
  },
  deep: {
    gradientTop: "#F5F0FF",
    gradientBottom: "#E7E2F4",
    blobPrimary: "rgba(109, 40, 217, 0.18)",
    blobSecondary: "rgba(49, 46, 129, 0.18)",
    headerSurface: "rgba(243, 239, 252, 0.72)",
    headerGlow: "rgba(99, 102, 241, 0.14)",
    headerAccentTrack: "rgba(79, 70, 229, 0.12)",
    headerAccentLine: "rgba(67, 56, 202, 0.44)",
    surfaceTint: "#EFE7FF",
    surfaceBorder: "#C4B5FD",
    titleText: "#3F255E",
    subtitleText: "#5B4B84",
    voiceLabelText: "#4C1D95",
    voiceSupportText: "#5B4B84",
    inputBarBackground: "#EDEAFF",
    inputBarBorder: "#C4B5FD",
    composerBackground: "#F6F3FF",
    composerBorder: "#C4B5FD",
    inputText: "#34224E",
    inputPlaceholder: "#8672A8",
    sendButtonBackground: "#5B21B6",
    sendButtonBorder: "#4C1D95",
    sendButtonText: "#FFFFFF",
    userMessageBackground: "#F3EEFF",
    userMessageBorder: "#D8CCFF",
    userMessageText: "#4C1D95",
    messageAccentText: "#6D28D9",
  },
};


const Onboarding = ({
  onSelect,
}: {
  onSelect: (preference: SpeakerPreference) => void;
}) => {
  const englishButton = useMicroButton();
  const chineseButton = useMicroButton();

  return (
    <SafeAreaView style={styles.onboardingContainer}>
      <View style={styles.onboardingCard}>
        <Text style={styles.onboardingTitle}>Welcome</Text>
        <Text style={styles.onboardingSubtitle}>
          Are you an English speaker or Chinese speaker?
        </Text>
        <View style={styles.onboardingButtons}>
          <Animated.View style={englishButton.style}>
            <Pressable
              style={styles.onboardingButton}
              {...englishButton.handlers}
              onPress={() => onSelect("english")}
            >
              <Text style={styles.onboardingButtonText}>English Speaker</Text>
            </Pressable>
          </Animated.View>
          <Animated.View style={chineseButton.style}>
            <Pressable
              style={[styles.onboardingButton, styles.onboardingButtonSecondary]}
              {...chineseButton.handlers}
              onPress={() => onSelect("chinese")}
            >
              <Text style={styles.onboardingButtonText}>Chinese Speaker</Text>
            </Pressable>
          </Animated.View>
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
  const [apiError, setApiError] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micPermission, setMicPermission] =
    useState<MicPermissionState>("undetermined");
  const [isRecording, setIsRecording] = useState(false);
  const [isUploadingVoice, setIsUploadingVoice] = useState(false);
  const [isPlayingPronunciation, setIsPlayingPronunciation] = useState(false);
  const [showVoiceComplete, setShowVoiceComplete] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceTurn, setVoiceTurn] = useState<SpeechTurnResponse | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<VoiceOption>("warm");
  const [isInputFocused, setIsInputFocused] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const completeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputFocusAnim = useRef(new Animated.Value(0)).current;
  const sendBurstAnim = useRef(new Animated.Value(0)).current;
  const stageTransition = useRef(new Animated.Value(0)).current;
  const ambientDriftA = useRef(new Animated.Value(0)).current;
  const ambientDriftB = useRef(new Animated.Value(0)).current;
  const headerEntrance = useRef(new Animated.Value(0)).current;
  const themeColorProgress = useRef(new Animated.Value(1)).current;
  const [themeFrom, setThemeFrom] = useState<VoiceOption>(selectedVoice);
  const [themeTo, setThemeTo] = useState<VoiceOption>(selectedVoice);

  useEffect(() => {
    logApiBaseUrl("App start");
    const loadAppLock = async () => {
      if (DEMO_MODE || CHATBOT_ONLY_MODE) {
        setIsAppUnlocked(true);
        setIsLoadingAppLock(false);
        return;
      }
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
    const init = async () => {
      const status = assertApiBaseUrl();
      if (!status.ok) {
        setApiError(status.reason);
        setIsBootstrapping(false);
        return;
      }
      setApiError(null);
      if (DEMO_MODE || CHATBOT_ONLY_MODE || !REQUIRE_AUTH) {
        setIsAuthenticated(true);
        setIsBootstrapping(false);
        return;
      }
      try {
        const refreshed = await refreshSession();
        if (refreshed) {
          const response = await apiFetch("/health");
          if (!response.ok) {
            throw new Error("Health check failed");
          }
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
        }
      } catch {
        setIsAuthenticated(false);
      } finally {
        setIsBootstrapping(false);
      }
    };

    void init();
  }, [isAppUnlocked]);

  useEffect(() => {
    if (!isAppUnlocked || !isAuthenticated) {
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
  }, [isAppUnlocked, isAuthenticated]);

  useEffect(() => {
    if (!CHATBOT_ONLY_MODE || preference) {
      return;
    }
    setPreference("english");
  }, [preference, CHATBOT_ONLY_MODE]);

  const handleUnlock = async () => {
    if (DEMO_MODE || CHATBOT_ONLY_MODE) {
      setIsAppUnlocked(true);
      return;
    }
    setIsUnlocking(true);
    try {
      await persistUnlock();
      setIsAppUnlocked(true);
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleLock = async () => {
    if (DEMO_MODE || CHATBOT_ONLY_MODE) {
      return;
    }
    await clearUnlock();
    setIsAppUnlocked(false);
  };

  const handleSelectPreference = async (selection: SpeakerPreference) => {
    setPreference(selection);
    await AsyncStorage.setItem(STORAGE_KEY, selection);
  };

  const handleSwitchLanguage = async (next: SpeakerPreference) => {
    if (next === preference) return;
    setMessages([]);
    setPreference(next);
    await AsyncStorage.setItem(STORAGE_KEY, next);
  };

  const handleLogin = async (username: string, password: string) => {
    if (!username || !password) {
      setAuthError("Enter both username and password.");
      return;
    }
    setIsAuthSubmitting(true);
    setAuthError(null);
    try {
      await login(username, password);
      const response = await apiFetch("/health");
      if (!response.ok) {
        throw new Error("Health check failed");
      }
      setIsAuthenticated(true);
    } catch (loginError) {
      console.error("Login error:", loginError);
      setAuthError("Login failed. Check credentials and try again.");
      setIsAuthenticated(false);
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setMessages([]);
    setPreference(null);
    setIsLoadingPreference(true);
    setIsAuthenticated(false);
  };

  const systemHint = useMemo(() => {
    if (preference === "english") {
      return "Explain in English, include Chinese + pinyin.";
    }
    if (preference === "chinese") {
      return "用中文讲解，包含英文和发音提示。";
    }
    return "";
  }, [preference]);

  const welcomeMessage = useMemo(() => {
    if (preference === "english") {
      return "Hi! I’m your Chinese tutor. Say hello or tell me what you want to practice.";
    }
    if (preference === "chinese") {
      return "Hello! I'm your Chinese tutor. Say hello, or tell me what you'd like to practice.";
    }
    return "";
  }, [preference]);

  const interpolatedTheme = useMemo(() => {
    const fromTheme = MODE_THEMES[themeFrom];
    const toTheme = MODE_THEMES[themeTo];
    const interpolateColor = (key: keyof ModeTheme) =>
      themeColorProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [fromTheme[key], toTheme[key]],
      });

    return {
      gradientTop: interpolateColor("gradientTop"),
      gradientBottom: interpolateColor("gradientBottom"),
      blobPrimary: interpolateColor("blobPrimary"),
      blobSecondary: interpolateColor("blobSecondary"),
      headerSurface: interpolateColor("headerSurface"),
      headerGlow: interpolateColor("headerGlow"),
      headerAccentTrack: interpolateColor("headerAccentTrack"),
      headerAccentLine: interpolateColor("headerAccentLine"),
      surfaceTint: interpolateColor("surfaceTint"),
      surfaceBorder: interpolateColor("surfaceBorder"),
      titleText: interpolateColor("titleText"),
      subtitleText: interpolateColor("subtitleText"),
      voiceLabelText: interpolateColor("voiceLabelText"),
      voiceSupportText: interpolateColor("voiceSupportText"),
      inputBarBackground: interpolateColor("inputBarBackground"),
      inputBarBorder: interpolateColor("inputBarBorder"),
      composerBackground: interpolateColor("composerBackground"),
      composerBorder: interpolateColor("composerBorder"),
      inputText: interpolateColor("inputText"),
      inputPlaceholder: interpolateColor("inputPlaceholder"),
      sendButtonBackground: interpolateColor("sendButtonBackground"),
      sendButtonBorder: interpolateColor("sendButtonBorder"),
      sendButtonText: interpolateColor("sendButtonText"),
      userMessageBackground: interpolateColor("userMessageBackground"),
      userMessageBorder: interpolateColor("userMessageBorder"),
      userMessageText: interpolateColor("userMessageText"),
      messageAccentText: interpolateColor("messageAccentText"),
    };
  }, [themeColorProgress, themeFrom, themeTo]);
  const activeTheme = MODE_THEMES[selectedVoice];

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

  const sendMessage = async (overrideText?: string) => {
    const trimmed = (overrideText ?? input).trim();
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
    if (!overrideText) setInput("");
    setIsSending(true);
    setError(null);
    sendBurstAnim.setValue(0);
    Animated.sequence([
      Animated.timing(sendBurstAnim, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(sendBurstAnim, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();

    try {
      logApiBaseUrl("Chat request");
      const response = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speaker: preference, // "english" | "chinese"
          messages: conversation.map((m) => ({
            role: m.role, // "user" | "assistant"
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
      setError(
        preference === "chinese"
          ? "抱歉，暂时无法连接到服务器。请稍后再试。"
          : "Could not reach the server. Please try again."
      );
      setMessages((prev) =>
        prev.filter((message) => !message.isTyping)
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleInputKeyPress = (
    event: NativeSyntheticEvent<TextInputKeyPressEventData>
  ) => {
    if (event.nativeEvent.key !== "Enter") {
      return;
    }
    const nativeEvent = event.nativeEvent as TextInputKeyPressEventData & {
      shiftKey?: boolean;
    };
    if (nativeEvent.shiftKey) {
      return;
    }
    (event as { preventDefault?: () => void }).preventDefault?.();
    void sendMessage();
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
      if (!status.isLoaded) {
        setIsPlayingPronunciation(false);
        return;
      }
      if (status.didJustFinish) {
        setIsPlayingPronunciation(false);
        if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current);
        completeTimeoutRef.current = setTimeout(() => {
          setShowVoiceComplete(false);
          completeTimeoutRef.current = null;
        }, 1500);
      }
    });
    await sound.loadAsync({ uri });
    setIsPlayingPronunciation(true);
    await sound.playAsync();
    soundRef.current = sound;
  };

  const pollForAudioJob = async (jobId: string) => {
    const maxAttempts = 10;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      logApiBaseUrl(`Audio poll attempt ${attempt}`);
      const { response } = await apiFetchWithTimeout(
        `/v1/speech/audio/${jobId}`,
        {
          method: "GET",
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
        const audioPayload: SpeechTurnAudio = {
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
    if (completeTimeoutRef.current) {
      clearTimeout(completeTimeoutRef.current);
      completeTimeoutRef.current = null;
    }
    setShowVoiceComplete(false);
    setVoiceError(null);
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
      setIsPlayingPronunciation(false);
    }
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
    setShowVoiceComplete(false);
    setIsPlayingPronunciation(false);
    setVoiceError(null);
    try {
      await recording.stopAndUnloadAsync();
      const status = await recording.getStatusAsync();
      const uri = recording.getURI();
      recordingRef.current = null;
      if (!uri) {
        throw new Error("Missing recording URI");
      }
      const fileInfo = await FileSystem.getInfoAsync(uri);
      const fileSize = "size" in fileInfo ? fileInfo.size : undefined;
      console.log("Voice recording duration (ms):", status.durationMillis);
      console.log("Voice recording file size (bytes):", fileSize);
      const formData = new FormData();
      formData.append("audio", {
        uri,
        name: "speech.m4a",
        type: "audio/mp4",
      } as any);
      formData.append("level", "beginner");
      formData.append("scenario", "restaurant");
      const sourceLang = preference === "chinese" ? "zh" : "en";
      const targetLang = preference === "chinese" ? "en" : "zh";
      formData.append("source_lang", sourceLang);
      formData.append("target_lang", targetLang);
      formData.append("voice", selectedVoice);

      logApiBaseUrl("Voice upload");
      const startedAt = Date.now();
      const { response } = await apiFetchWithTimeout(
        "/v1/speech/turn",
        {
          method: "POST",
          body: formData,
        },
        90_000,
        1
      );

      const durationMs = Date.now() - startedAt;
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
      setShowVoiceComplete(true);
      if (completeTimeoutRef.current) {
        clearTimeout(completeTimeoutRef.current);
      }
      completeTimeoutRef.current = setTimeout(() => {
        setShowVoiceComplete(false);
        completeTimeoutRef.current = null;
      }, 8000);
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
          setIsPlayingPronunciation(false);
          setVoiceError(
            "Audio playback failed. Please check your volume and try again."
          );
        }
      } else if (data.audio_pending && data.audio_job_id) {
        await pollForAudioJob(data.audio_job_id);
      } else {
        setVoiceError(data.tts_error ?? "Audio unavailable. Please try again.");
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

  const voiceStageState: VoiceStageState = isRecording
    ? "listening"
    : isUploadingVoice
    ? "processing"
    : isPlayingPronunciation
    ? "speaking"
    : showVoiceComplete
    ? "complete"
    : "idle";

  useEffect(() => {
    Animated.timing(inputFocusAnim, {
      toValue: isInputFocused ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [inputFocusAnim, isInputFocused]);

  useEffect(() => {
    const next =
      voiceStageState === "idle"
        ? 0
        : voiceStageState === "listening"
        ? 1
        : voiceStageState === "processing"
        ? 2
        : voiceStageState === "speaking"
        ? 3
        : 4;
    Animated.timing(stageTransition, {
      toValue: next,
      duration: 320,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [stageTransition, voiceStageState]);

  useEffect(() => {
    return () => {
      if (completeTimeoutRef.current) {
        clearTimeout(completeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    ambientDriftA.setValue(0);
    ambientDriftB.setValue(0);

    const loopA = Animated.loop(
      Animated.sequence([
        Animated.timing(ambientDriftA, {
          toValue: 1,
          duration: 30000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(ambientDriftA, {
          toValue: 0,
          duration: 30000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    const loopB = Animated.loop(
      Animated.sequence([
        Animated.timing(ambientDriftB, {
          toValue: 1,
          duration: 42000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(ambientDriftB, {
          toValue: 0,
          duration: 42000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    loopA.start();
    loopB.start();

    return () => {
      loopA.stop();
      loopB.stop();
    };
  }, [ambientDriftA, ambientDriftB]);

  useEffect(() => {
    if (selectedVoice === themeTo) {
      return;
    }
    setThemeFrom(themeTo);
    setThemeTo(selectedVoice);
    themeColorProgress.stopAnimation();
    themeColorProgress.setValue(0);
    Animated.timing(themeColorProgress, {
      toValue: 1,
      duration: 900,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [selectedVoice, themeColorProgress, themeTo]);

  useEffect(() => {
    Animated.timing(headerEntrance, {
      toValue: 1,
      duration: 680,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [headerEntrance]);

  const handleMicPress = async () => {
    if (isUploadingVoice) {
      return;
    }
    if (isRecording) {
      await stopRecording();
      return;
    }
    await startRecording();
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

  const micButton = useMicroButton();
  const sendButton = useMicroButton();
  const canSend = input.trim().length > 0 && !isSending;

  const handleSuggestionPress = useCallback(
    (text: string) => { void sendMessage(text); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preference, messages, isSending]
  );

  const renderItem = ({ item }: { item: ChatMessage }) => (
    <MessageBubble
      item={item}
      theme={activeTheme}
      preference={preference}
      onSuggestionPress={handleSuggestionPress}
    />
  );

  if (isLoadingAppLock) {
    return <LoadingState title="Preparing your tutor" subtitle="One quick moment..." />;
  }

  if (!isAppUnlocked) {
    return <LockScreen onUnlock={handleUnlock} isSubmitting={isUnlocking} />;
  }

  if (apiError) {
    return <ApiBlockedScreen reason={apiError} />;
  }

  if (isBootstrapping) {
    return <LoadingState title="Connecting" subtitle="Setting up your learning session..." />;
  }

  if (
    REQUIRE_AUTH &&
    !DEMO_MODE &&
    !CHATBOT_ONLY_MODE &&
    !isAuthenticated
  ) {
    return (
      <AuthScreen
        onSubmit={handleLogin}
        isSubmitting={isAuthSubmitting}
        error={authError}
      />
    );
  }

  if (isLoadingPreference) {
    return <LoadingState title="Loading preferences" subtitle="Restoring your tutor mode..." />;
  }

  if (!preference) {
    return <Onboarding onSelect={handleSelectPreference} />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View pointerEvents="none" style={styles.ambientBackground}>
        <Animated.View
          style={[
            styles.ambientGradientLayer,
            { backgroundColor: interpolatedTheme.gradientTop },
          ]}
        />
        <Animated.View
          style={[
            styles.ambientGradientLayerBottom,
            { backgroundColor: interpolatedTheme.gradientBottom },
          ]}
        />
        <Animated.View
          style={[
            styles.ambientBlobPrimary,
            {
              backgroundColor: interpolatedTheme.blobPrimary,
              transform: [
                {
                  translateX: ambientDriftA.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-24, 26],
                  }),
                },
                {
                  translateY: ambientDriftA.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-18, 22],
                  }),
                },
                {
                  scale: ambientDriftA.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.08],
                  }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.ambientBlobSecondary,
            {
              backgroundColor: interpolatedTheme.blobSecondary,
              transform: [
                {
                  translateX: ambientDriftB.interpolate({
                    inputRange: [0, 1],
                    outputRange: [22, -26],
                  }),
                },
                {
                  translateY: ambientDriftB.interpolate({
                    inputRange: [0, 1],
                    outputRange: [20, -18],
                  }),
                },
                {
                  scale: ambientDriftB.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1.03, 0.98],
                  }),
                },
              ],
            },
          ]}
        />
      </View>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
      >
        <Animated.View
          style={[
            styles.headerHero,
            {
              backgroundColor: interpolatedTheme.headerSurface,
              opacity: headerEntrance.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 1],
              }),
              transform: [
                {
                  translateY: headerEntrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: [10, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Animated.View
            style={[
              styles.headerAccentGlow,
              { backgroundColor: interpolatedTheme.headerGlow },
            ]}
          />
          <View style={styles.headerTitleRow}>
            <View style={styles.headerTitleBlock}>
              <Animated.Text
                style={[styles.title, { color: interpolatedTheme.titleText }]}
                onLongPress={DEMO_MODE || CHATBOT_ONLY_MODE ? undefined : handleLock}
              >
                {preference === "chinese" ? "英语导师" : "Chinese Tutor"}
              </Animated.Text>
              <View style={[styles.headerLangPairBadge, { borderColor: interpolatedTheme.titleText }]}>
                <Text style={[styles.headerLangPairBadgeText, { color: interpolatedTheme.titleText }]}>
                  {preference === "chinese" ? "中文 → 英语" : "中文 ↔ EN"}
                </Text>
              </View>
            </View>
            <View style={styles.headerRight}>
              <View style={styles.langToggle}>
                <Pressable
                  style={[styles.langPill, preference === "english" && styles.langPillActive]}
                  onPress={() => void handleSwitchLanguage("english")}
                >
                  <Text style={[styles.langPillText, preference === "english" && styles.langPillTextActive]}>EN</Text>
                </Pressable>
                <Pressable
                  style={[styles.langPill, preference === "chinese" && styles.langPillActive]}
                  onPress={() => void handleSwitchLanguage("chinese")}
                >
                  <Text style={[styles.langPillText, preference === "chinese" && styles.langPillTextActive]}>中</Text>
                </Pressable>
              </View>
              {DEMO_MODE || CHATBOT_ONLY_MODE || !REQUIRE_AUTH ? null : (
                <Pressable onPress={handleLogout}>
                  <Text style={styles.logoutText}>Logout</Text>
                </Pressable>
              )}
            </View>
          </View>
          <Animated.Text
            style={[styles.subtitle, { color: interpolatedTheme.subtitleText }]}
          >
            {systemHint}
          </Animated.Text>
          <Animated.View
            style={[
              styles.headerAccentTrack,
              { backgroundColor: interpolatedTheme.headerAccentTrack },
            ]}
          >
            <Animated.View
              style={[
                styles.headerAccentLine,
                { backgroundColor: interpolatedTheme.headerAccentLine },
              ]}
            />
          </Animated.View>
        </Animated.View>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Animated.View
          style={[
            styles.voiceCard,
            {
              backgroundColor: interpolatedTheme.surfaceTint,
              borderColor: interpolatedTheme.surfaceBorder,
            },
          ]}
        >
          <Animated.Text
            style={[styles.voiceTitle, { color: interpolatedTheme.voiceLabelText }]}
          >
            {preference === "chinese" ? "语音对话" : "Voice Turn"}
          </Animated.Text>
          <Animated.Text
            style={[styles.voiceSubtitle, { color: interpolatedTheme.voiceSupportText }]}
          >
            {preference === "chinese"
              ? "按住按钮，说一句中文，松开后听英文翻译。"
              : "Hold the button, speak, and release to translate + hear it back."}
          </Animated.Text>
          {micPermission === "denied" ? (
            <Text style={styles.voiceError}>
              Microphone access is disabled. Enable it in system settings.
            </Text>
          ) : null}
          {voiceError ? (
            <Text style={styles.voiceError}>{voiceError}</Text>
          ) : null}
          <View style={styles.voiceOptionsRow}>
            {[
              { key: "warm", label: "Warm" },
              { key: "bright", label: "Bright" },
              { key: "deep", label: "Deep" },
            ].map((option) => (
              <Pressable
                key={option.key}
                style={[
                  styles.voiceOptionPill,
                  selectedVoice === option.key && styles.voiceOptionPillActive,
                ]}
                onPress={() => setSelectedVoice(option.key as VoiceOption)}
                disabled={isRecording || isUploadingVoice}
              >
                <Text
                  style={[
                    styles.voiceOptionText,
                    selectedVoice === option.key && styles.voiceOptionTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Animated.View
            style={{
              opacity: stageTransition.interpolate({
                inputRange: [0, 1, 2, 3],
                outputRange: [1, 0.96, 0.95, 0.98],
              }),
              transform: [
                {
                  translateY: stageTransition.interpolate({
                    inputRange: [0, 1, 2, 3],
                    outputRange: [0, -1, -2, -1],
                  }),
                },
              ],
            }}
          >
            <VoiceStage
              state={voiceStageState}
              mode={selectedVoice}
              onPressIn={() => {
                void startRecording();
              }}
              onPressOut={() => {
                void stopRecording();
              }}
              disabled={isUploadingVoice || micPermission === "denied"}
            />
          </Animated.View>
          {voiceTurn ? (
            <View
              style={[
                styles.voiceResult,
                {
                  borderColor: activeTheme.surfaceBorder,
                },
              ]}
            >
              <Text style={[styles.voiceLabel, { color: activeTheme.messageAccentText }]}>
                Transcript
              </Text>
              <Text style={[styles.voiceValue, { color: activeTheme.voiceLabelText }]}>
                {voiceTurn.transcript}
              </Text>
              <Text style={[styles.voiceLabel, { color: activeTheme.messageAccentText }]}>
                Chinese
              </Text>
              <Text style={[styles.voiceValue, { color: activeTheme.voiceLabelText }]}>
                {voiceTurn.chinese}
              </Text>
              <Text style={[styles.voiceLabel, { color: activeTheme.messageAccentText }]}>
                Pinyin
              </Text>
              <Text style={[styles.voiceValue, { color: activeTheme.voiceLabelText }]}>
                {voiceTurn.pinyin}
              </Text>
              {voiceTurn.tts_error ? (
                <Text style={[styles.voiceAudioNote, { color: activeTheme.voiceSupportText }]}>
                  Audio unavailable
                </Text>
              ) : null}
            </View>
          ) : null}
        </Animated.View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.messagesContent}
          ListEmptyComponent={<EmptyChatState preference={preference} />}
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: true })
          }
        />

        <Animated.View style={[styles.inputBar, { backgroundColor: interpolatedTheme.inputBarBackground, borderTopColor: interpolatedTheme.inputBarBorder }]}>
          <Animated.View
            style={[
              styles.inputShell,
              {
                backgroundColor: interpolatedTheme.composerBackground,
                borderColor: interpolatedTheme.composerBorder,
                shadowOpacity: inputFocusAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.03, 0.1],
                }),
                shadowRadius: inputFocusAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [5, 12],
                }),
              },
            ]}
          >
            <TextInput
              style={[
                styles.input,
                { color: activeTheme.inputText },
                Platform.OS === "web" ? ({ outlineWidth: 0 } as never) : null,
              ]}
              placeholder={preference === "chinese" ? "一起学习吧" : "Let's Learn Together"}
              placeholderTextColor={activeTheme.inputPlaceholder}
              selectionColor="#A06B43"
              value={input}
              onChangeText={setInput}
              editable={!isSending}
              multiline
              onKeyPress={handleInputKeyPress}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
            />
          </Animated.View>
          <Animated.View style={micButton.style}>
            <Pressable
              style={[
                styles.micButton,
                isRecording && styles.micButtonActive,
                (isUploadingVoice || micPermission === "denied") &&
                  styles.micButtonDisabled,
              ]}
              onPress={handleMicPress}
              disabled={isUploadingVoice || micPermission === "denied"}
              {...micButton.handlers}
            >
              <Text style={styles.micButtonText}>{isRecording ? "⏹" : "🎤"}</Text>
            </Pressable>
          </Animated.View>
          <Animated.View style={sendButton.style}>
            <Animated.View
              style={{
                transform: [
                  {
                    translateX: sendBurstAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, 2],
                    }),
                  },
                ],
              }}
            >
              <Pressable
                style={[
                  styles.sendButton,
                  {
                    backgroundColor: activeTheme.sendButtonBackground,
                    borderColor: activeTheme.sendButtonBorder,
                  },
                  (!canSend || isSending) && styles.sendButtonDisabled,
                ]}
                onPress={sendMessage}
                disabled={!canSend || isSending}
                {...sendButton.handlers}
              >
                <Animated.View
                  style={[
                    styles.sendButtonContent,
                    {
                      transform: [
                        {
                          translateX: sendBurstAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, 5],
                          }),
                        },
                      ],
                      opacity: sendBurstAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 0.88],
                      }),
                    },
                  ]}
                >
                  <Text style={[styles.sendButtonIcon, { color: activeTheme.sendButtonText }]}>➤</Text>
                  <Text style={[styles.sendButtonText, { color: activeTheme.sendButtonText }]}>
                    {isSending ? "Sending" : "Send"}
                  </Text>
                </Animated.View>
              </Pressable>
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FDF8F2",
  },
  ambientBackground: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  ambientGradientLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  ambientGradientLayerBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "68%",
    opacity: 0.82,
  },
  ambientBlobPrimary: {
    position: "absolute",
    width: 420,
    height: 420,
    borderRadius: 420,
    top: -120,
    right: -120,
    opacity: 0.75,
  },
  ambientBlobSecondary: {
    position: "absolute",
    width: 460,
    height: 460,
    borderRadius: 460,
    bottom: -170,
    left: -150,
    opacity: 0.62,
  },
  keyboardAvoid: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    backgroundColor: "#FDF8F2",
  },
  loadingTitle: {
    marginTop: 14,
    fontSize: 18,
    fontWeight: "700",
    color: "#7C2D12",
  },
  loadingSubtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    color: "#9A5A2B",
    textAlign: "center",
  },
  headerHero: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 16,
    borderBottomWidth: 1.5,
    borderBottomColor: "rgba(245, 208, 169, 0.7)",
  },
  headerTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitleBlock: {
    flexDirection: "column",
    gap: 5,
  },
  headerLangPairBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    opacity: 0.65,
  },
  headerLangPairBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
  headerAccentGlow: {
    position: "absolute",
    width: 230,
    height: 230,
    borderRadius: 230,
    right: -80,
    top: -110,
  },
  title: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: "800",
    letterSpacing: -0.6,
    color: "#6B2C12",
  },
  subtitle: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 18,
    color: "#9A5A2B",
  },
  headerAccentTrack: {
    marginTop: 10,
    width: "100%",
    height: 2,
    borderRadius: 2,
    overflow: "hidden",
  },
  headerAccentLine: {
    width: "42%",
    height: "100%",
    borderRadius: 2,
  },
  logoutText: {
    fontSize: 12,
    color: "#B91C1C",
    fontWeight: "600",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  langToggle: {
    flexDirection: "row",
    gap: 4,
  },
  langPill: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "rgba(107, 44, 18, 0.2)",
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  langPillActive: {
    backgroundColor: "rgba(107, 44, 18, 0.14)",
    borderColor: "rgba(107, 44, 18, 0.6)",
  },
  langPillText: {
    fontSize: 13,
    fontWeight: "700",
    color: "rgba(107, 44, 18, 0.38)",
    letterSpacing: 0.3,
  },
  langPillTextActive: {
    color: "#6B2C12",
  },
  messagesContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 20,
    gap: 6,
  },
  emptyStateCard: {
    marginTop: 16,
    backgroundColor: "rgba(255, 253, 249, 0.95)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#EEDCC7",
    paddingHorizontal: 16,
    paddingVertical: 16,
    shadowColor: "#A16207",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  emptyStateEyebrow: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: "#B45309",
    fontWeight: "700",
  },
  emptyStateTitle: {
    marginTop: 6,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
    color: "#7C2D12",
  },
  emptyStateBody: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 20,
    color: "#9A5A2B",
  },
  messageBubble: {
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingVertical: 11,
    marginBottom: 8,
    maxWidth: "88%",
    borderWidth: 1,
  },
  userBubble: {
    backgroundColor: "#FFF7ED",
    borderColor: "#FCD9B1",
    alignSelf: "flex-end",
    shadowColor: "#A16207",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  botBubble: {
    backgroundColor: "transparent",
    borderColor: "transparent",
    alignSelf: "flex-start",
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  userText: {
    color: "#7C2D12",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "500",
  },
  botText: {
    color: "#581C87",
    fontSize: 14,
    lineHeight: 20,
  },
  typingDotsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: "#7E22CE",
    marginRight: 4,
  },
  typingText: {
    marginLeft: 6,
    color: "#7E22CE",
    fontSize: 12,
    fontWeight: "500",
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: 1,
  },
  inputShell: {
    flex: 1,
    backgroundColor: "#FFFDF9",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E7DAC8",
    shadowColor: "#8A6648",
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 1,
  },
  input: {
    width: "100%",
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: "#4A2F1A",
    lineHeight: 20,
    maxHeight: 120,
    minHeight: 46,
  },
  micButton: {
    marginLeft: 8,
    backgroundColor: "#EA580C",
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  micButtonActive: {
    backgroundColor: "#7F1D1D",
  },
  micButtonDisabled: {
    backgroundColor: "#D4A373",
  },
  micButtonText: {
    color: "#FFFFFF",
    fontSize: 18,
  },
  sendButton: {
    marginLeft: 10,
    minHeight: 44,
    minWidth: 88,
    backgroundColor: "#8F5A33",
    borderWidth: 1,
    borderColor: "#7B4925",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    shadowColor: "#6B4428",
    shadowOpacity: 0.16,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
    justifyContent: "center",
  },
  sendButtonDisabled: {
    backgroundColor: "#CCBBA8",
    borderColor: "#CCBBA8",
  },
  sendButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  sendButtonIcon: {
    color: "#FFFFFF",
    fontSize: 12,
    marginTop: -1,
  },
  sendButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
    letterSpacing: 0.2,
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
    borderWidth: 1,
  },
  voiceTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#9A3412",
  },
  voiceSubtitle: {
    marginTop: 6,
    fontSize: 12,
    color: "#92400E",
  },
  voiceError: {
    marginTop: 8,
    fontSize: 12,
    color: "#B91C1C",
  },
  voiceOptionsRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
  },
  voiceOptionPill: {
    backgroundColor: "#FED7AA",
    borderWidth: 1,
    borderColor: "#FDBA74",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  voiceOptionPillActive: {
    backgroundColor: "#C2410C",
    borderColor: "#9A3412",
  },
  voiceOptionText: {
    color: "#9A3412",
    fontSize: 12,
    fontWeight: "600",
  },
  voiceOptionTextActive: {
    color: "#FFFFFF",
  },
  voiceButton: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: "#B91C1C",
    alignItems: "center",
  },
  voiceButtonActive: {
    backgroundColor: "#991B1B",
  },
  voiceButtonDisabled: {
    backgroundColor: "#D4A373",
  },
  voiceButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 14,
  },
  voiceResult: {
    marginTop: 12,
    backgroundColor: "#FFF7ED",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FED7AA",
    padding: 12,
  },
  voiceLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#92400E",
    textTransform: "uppercase",
    marginTop: 8,
  },
  voiceValue: {
    marginTop: 4,
    fontSize: 14,
    color: "#9A3412",
  },
  voiceAudioNote: {
    marginTop: 8,
    fontSize: 12,
    color: "#92400E",
  },
  onboardingContainer: {
    flex: 1,
    backgroundColor: "#FFF7ED",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  onboardingCard: {
    backgroundColor: "#FFF7ED",
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
    color: "#7C2D12",
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
    backgroundColor: "#B91C1C",
    paddingVertical: 12,
    borderRadius: 18,
    alignItems: "center",
    marginBottom: 12,
  },
  onboardingButtonSecondary: {
    backgroundColor: "#7C2D12",
  },
  onboardingButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 14,
  },
});
