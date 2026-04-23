import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { useFonts, Fraunces_500Medium_Italic } from "@expo-google-fonts/fraunces";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useUIStore } from "./src/store/uiStore";

import ApiBlockedScreen from "./src/components/ApiBlockedScreen";
import AuthScreen from "./src/components/AuthScreen";
import LockScreen from "./src/components/LockScreen";
import VoiceStage, { type VoiceStageState } from "./src/components/VoiceStage";
import {
  clearUnlock,
  hasValidUnlock,
  persistUnlock,
} from "./src/config/appLock";
import { assertApiBaseUrl, logApiBaseUrl } from "./src/config/api";
import { apiFetch, apiFetchWithTimeout } from "./src/config/apiClient";
import { login, logout, refreshSession } from "./src/config/auth";

const STORAGE_KEY = "speakerPreference";

const DAILY_PHRASES = [
  { chinese: "你好", pinyin: "nǐ hǎo", english: "Hello" },
  { chinese: "谢谢", pinyin: "xiè xiè", english: "Thank you" },
  { chinese: "再见", pinyin: "zài jiàn", english: "Goodbye" },
  { chinese: "早上好", pinyin: "zǎo shàng hǎo", english: "Good morning" },
  { chinese: "晚安", pinyin: "wǎn ān", english: "Good night" },
  { chinese: "对不起", pinyin: "duì bù qǐ", english: "I'm sorry" },
  { chinese: "没关系", pinyin: "méi guān xì", english: "It's okay" },
  { chinese: "请问", pinyin: "qǐng wèn", english: "Excuse me" },
  { chinese: "加油", pinyin: "jiā yóu", english: "You can do it!" },
  { chinese: "太好了", pinyin: "tài hǎo le", english: "That's great!" },
  { chinese: "我喜欢", pinyin: "wǒ xǐ huān", english: "I like it" },
  { chinese: "多少钱", pinyin: "duō shǎo qián", english: "How much?" },
  { chinese: "不客气", pinyin: "bú kè qì", english: "You're welcome" },
  { chinese: "慢慢来", pinyin: "màn màn lái", english: "Take your time" },
  { chinese: "吃饭了吗", pinyin: "chī fàn le ma", english: "Have you eaten?" },
  { chinese: "开心", pinyin: "kāi xīn", english: "Happy" },
  { chinese: "朋友", pinyin: "péng yǒu", english: "Friend" },
  { chinese: "学习", pinyin: "xué xí", english: "To study" },
  { chinese: "辛苦了", pinyin: "xīn kǔ le", english: "Thanks for your hard work" },
  { chinese: "一起走吧", pinyin: "yī qǐ zǒu ba", english: "Let's go together" },
  { chinese: "好久不见", pinyin: "hǎo jiǔ bú jiàn", english: "Long time no see" },
  { chinese: "明天见", pinyin: "míng tiān jiàn", english: "See you tomorrow" },
  { chinese: "我来了", pinyin: "wǒ lái le", english: "I'm here" },
  { chinese: "别担心", pinyin: "bié dān xīn", english: "Don't worry" },
  { chinese: "没问题", pinyin: "méi wèn tí", english: "No problem" },
  { chinese: "真棒", pinyin: "zhēn bàng", english: "Awesome!" },
  { chinese: "下次再说", pinyin: "xià cì zài shuō", english: "Let's talk next time" },
  { chinese: "随便你", pinyin: "suí biàn nǐ", english: "Up to you" },
  { chinese: "我知道了", pinyin: "wǒ zhī dào le", english: "I understand" },
  { chinese: "你真厉害", pinyin: "nǐ zhēn lì hài", english: "You're amazing" },
  { chinese: "路上小心", pinyin: "lù shàng xiǎo xīn", english: "Be safe on the road" },
];

const getDailyPhrase = () => {
  const startOfYear = new Date(new Date().getFullYear(), 0, 0).getTime();
  const now = new Date().getTime();
  const dayOfYear = Math.floor((now - startOfYear) / 86400000);
  return DAILY_PHRASES[dayOfYear % DAILY_PHRASES.length];
};

const isTruthy = (value: string | undefined) =>
  ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase());

const DEMO_MODE = isTruthy(process.env.EXPO_PUBLIC_DEMO_MODE);
const CHATBOT_ONLY_MODE = isTruthy(
  process.env.EXPO_PUBLIC_CHATBOT_ONLY_MODE
);
const REQUIRE_AUTH =
  isTruthy(process.env.EXPO_PUBLIC_REQUIRE_AUTH) &&
  process.env.NODE_ENV === "production";

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

type VoiceExchange = {
  id: string;
  userTranscript: string;
  tutorChinese: string;
  tutorPinyin: string;
  tutorEnglish: string;
};

type PracticeScenario = {
  id: "ordering_food" | "taking_taxi" | "meeting_someone_new";
  title: string;
  description: string;
  vocab: Array<{ chinese: string; pinyin: string; english: string }>;
};

const PRACTICE_SCENARIOS: PracticeScenario[] = [
  {
    id: "ordering_food",
    title: "Ordering Food",
    description: "Practice ordering dishes and asking about prices.",
    vocab: [
      { chinese: "菜单", pinyin: "cài dān", english: "Menu" },
      { chinese: "点菜", pinyin: "diǎn cài", english: "Order food" },
      { chinese: "这个", pinyin: "zhè gè", english: "This one" },
      { chinese: "买单", pinyin: "mǎi dān", english: "Check, please" },
    ],
  },
  {
    id: "taking_taxi",
    title: "Taking a Taxi",
    description: "Practice giving directions and confirming destination details.",
    vocab: [
      { chinese: "出租车", pinyin: "chū zū chē", english: "Taxi" },
      { chinese: "去这里", pinyin: "qù zhè lǐ", english: "Go here" },
      { chinese: "多少钱", pinyin: "duō shǎo qián", english: "How much?" },
      { chinese: "请快一点", pinyin: "qǐng kuài yì diǎn", english: "Please go faster" },
    ],
  },
  {
    id: "meeting_someone_new",
    title: "Meeting Someone New",
    description: "Practice introductions and small talk.",
    vocab: [
      { chinese: "认识你很高兴", pinyin: "rèn shi nǐ hěn gāo xìng", english: "Nice to meet you" },
      { chinese: "我叫…", pinyin: "wǒ jiào…", english: "My name is..." },
      { chinese: "你从哪里来", pinyin: "nǐ cóng nǎ lǐ lái", english: "Where are you from?" },
      { chinese: "我们可以做朋友吗", pinyin: "wǒ men kě yǐ zuò péng yǒu ma", english: "Can we be friends?" },
    ],
  },
];

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


const useMicroButton = () => {
  const scale = useRef(new Animated.Value(1)).current;
  const brightness = useRef(new Animated.Value(0)).current;
  const opacity = useRef(
    brightness.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0.92],
    })
  ).current;

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
        useNativeDriver: true,
      }),
    ]).start();
  }, [brightness, scale]);

  return {
    style: {
      transform: [{ scale }],
      opacity,
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
  const [error, setError] = useState<string | null>(null);
  const [micPermission, setMicPermission] =
    useState<MicPermissionState>("undetermined");
  const [isRecording, setIsRecording] = useState(false);
  const [isUploadingVoice, setIsUploadingVoice] = useState(false);
  const [isPlayingPronunciation, setIsPlayingPronunciation] = useState(false);
  const [showVoiceComplete, setShowVoiceComplete] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceTurn, setVoiceTurn] = useState<SpeechTurnResponse | null>(null);
  const [voiceHistory, setVoiceHistory] = useState<VoiceExchange[]>([]);
  const [showScenarioPicker, setShowScenarioPicker] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<PracticeScenario | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<VoiceOption>("warm");
  const [showDrawer, setShowDrawer] = useState(false);
  const [fontsLoaded] = useFonts({ Fraunces_500Medium_Italic });
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const completeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageTransition = useRef(new Animated.Value(0)).current;
  const ambientDriftA = useRef(new Animated.Value(0)).current;
  const ambientDriftB = useRef(new Animated.Value(0)).current;
  const headerEntrance = useRef(new Animated.Value(0)).current;

  const ambientDriftATranslateX = useRef(ambientDriftA.interpolate({ inputRange: [0, 1], outputRange: [-24, 26] })).current;
  const ambientDriftATranslateY = useRef(ambientDriftA.interpolate({ inputRange: [0, 1], outputRange: [-18, 22] })).current;
  const ambientDriftAScale = useRef(ambientDriftA.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] })).current;
  const ambientDriftBTranslateX = useRef(ambientDriftB.interpolate({ inputRange: [0, 1], outputRange: [22, -26] })).current;
  const ambientDriftBTranslateY = useRef(ambientDriftB.interpolate({ inputRange: [0, 1], outputRange: [20, -18] })).current;
  const ambientDriftBScale = useRef(ambientDriftB.interpolate({ inputRange: [0, 1], outputRange: [1.03, 0.98] })).current;
  const headerEntranceOpacity = useRef(headerEntrance.interpolate({ inputRange: [0, 1], outputRange: [0, 1] })).current;
  const headerEntranceTranslateY = useRef(headerEntrance.interpolate({ inputRange: [0, 1], outputRange: [10, 0] })).current;
  const stageTransitionOpacity = useRef(stageTransition.interpolate({ inputRange: [0, 1, 2, 3], outputRange: [1, 0.96, 0.95, 0.98] })).current;
  const stageTransitionTranslateY = useRef(stageTransition.interpolate({ inputRange: [0, 1, 2, 3], outputRange: [0, -1, -2, -1] })).current;

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
    setVoiceTurn(null);
    setVoiceHistory([]);
    setVoiceError(null);
    setPreference(next);
    await AsyncStorage.setItem(STORAGE_KEY, next);
  };

  const handleSelectScenario = (scenario: PracticeScenario) => {
    setSelectedScenario(scenario);
    setShowScenarioPicker(false);
    setVoiceTurn(null);
    setVoiceHistory([]);
    setVoiceError(null);
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
    setVoiceTurn(null);
    setVoiceHistory([]);
    setVoiceError(null);
    setPreference(null);
    setIsLoadingPreference(true);
    setIsAuthenticated(false);
  };

  const activeTheme = MODE_THEMES[selectedVoice];

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
      if (!status.durationMillis || status.durationMillis < 200) {
        throw new Error("Recording too short. Please hold the button longer.");
      }
      const formData = new FormData();
      formData.append("audio", {
        uri,
        name: "speech.m4a",
        type: "audio/mp4",
      } as any);
      formData.append("level", "beginner");
      formData.append("scenario", selectedScenario?.id ?? "general");
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
      setVoiceHistory((previous) => [
        ...previous.slice(-2),
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          userTranscript: data.transcript,
          tutorChinese: data.chinese,
          tutorPinyin: data.pinyin,
          tutorEnglish: data.assistant_text,
        },
      ]);
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
      const errMsg =
        voiceUploadError instanceof Error ? voiceUploadError.message : "";
      const isTimeout =
        voiceUploadError instanceof Error &&
        (voiceUploadError.name === "AbortError" ||
          errMsg.toLowerCase().includes("timed out"));
      const isTooShort = errMsg.includes("Recording too short");
      setVoiceError(
        isTooShort
          ? errMsg
          : isTimeout
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
    Animated.timing(headerEntrance, {
      toValue: 1,
      duration: 680,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [headerEntrance]);

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
        <View
          style={[
            styles.ambientGradientLayer,
            { backgroundColor: activeTheme.gradientTop },
          ]}
        />
        <View
          style={[
            styles.ambientGradientLayerBottom,
            { backgroundColor: activeTheme.gradientBottom },
          ]}
        />
        <Animated.View
          style={[
            styles.ambientBlobPrimary,
            {
              transform: [
                { translateX: ambientDriftATranslateX },
                { translateY: ambientDriftATranslateY },
                { scale: ambientDriftAScale },
              ],
            },
          ]}
        >
          <View
            style={[StyleSheet.absoluteFillObject, { backgroundColor: activeTheme.blobPrimary }]}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.ambientBlobSecondary,
            {
              transform: [
                { translateX: ambientDriftBTranslateX },
                { translateY: ambientDriftBTranslateY },
                { scale: ambientDriftBScale },
              ],
            },
          ]}
        >
          <View
            style={[StyleSheet.absoluteFillObject, { backgroundColor: activeTheme.blobSecondary }]}
          />
        </Animated.View>
      </View>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
      >
        <Animated.View
          style={[
            styles.headerHero,
            {
              opacity: headerEntranceOpacity,
              transform: [{ translateY: headerEntranceTranslateY }],
            },
          ]}
        >
          <View
            style={[StyleSheet.absoluteFillObject, { backgroundColor: activeTheme.headerSurface }]}
          />
          {/* Title row */}
          <View style={styles.headerTitleRow}>
            <Text
              style={[
                styles.headerWordmark,
                fontsLoaded ? { fontFamily: "Fraunces_500Medium_Italic" } : {},
              ]}
              onLongPress={DEMO_MODE || CHATBOT_ONLY_MODE ? undefined : handleLock}
            >
              Tutor
            </Text>
            <View style={styles.headerRight}>
              {/* EN → 中 pill */}
              <View style={styles.langPillContainer}>
                <Pressable onPress={() => void handleSwitchLanguage("english")}>
                  <Text
                    style={[
                      styles.langPillSide,
                      preference === "english" && styles.langPillSideActive,
                    ]}
                  >
                    EN
                  </Text>
                </Pressable>
                <Text style={styles.langPillSeparator}>→</Text>
                <Pressable onPress={() => void handleSwitchLanguage("chinese")}>
                  <Text
                    style={[
                      styles.langPillSide,
                      preference === "chinese" && styles.langPillSideActive,
                    ]}
                  >
                    中
                  </Text>
                </Pressable>
              </View>
              {/* Hamburger menu */}
              <Pressable onPress={() => setShowDrawer(true)} style={styles.menuButton}>
                <Text style={styles.menuIcon}>≡</Text>
              </Pressable>
            </View>
          </View>
          {/* Tab bar */}
          <View style={styles.tabBar}>
            {(["SPEAK", "HISTORY", "SAVED"] as const).map((tab) => (
              <Pressable key={tab} onPress={() => setActiveTab(tab)} style={styles.tabItem}>
                <Text style={[styles.tabLabel, activeTab === tab && styles.tabLabelActive]}>
                  {tab}
                </Text>
                {activeTab === tab && <View style={styles.tabUnderline} />}
              </Pressable>
            ))}
          </View>
        </Animated.View>

        {error || voiceError || micPermission === "denied" ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>
              {micPermission === "denied"
                ? "Microphone access is disabled. Enable it in system settings."
                : voiceError ?? error}
            </Text>
          </View>
        ) : null}

        {activeTab === "HISTORY" ? (
          <View style={styles.tabPlaceholder}>
            <Text style={styles.tabPlaceholderText}>History</Text>
          </View>
        ) : activeTab === "SAVED" ? (
          <View style={styles.tabPlaceholder}>
            <Text style={styles.tabPlaceholderText}>Saved</Text>
          </View>
        ) : null}
        {activeTab === "SPEAK" ? <View style={styles.centerStage}>
          <View style={styles.practiceScenarioWrap}>
            <Pressable
              style={[
                styles.practiceScenarioButton,
                {
                  backgroundColor: activeTheme.surfaceTint,
                  borderColor: activeTheme.surfaceBorder,
                },
              ]}
              onPress={() => setShowScenarioPicker((previous) => !previous)}
            >
              <Text style={[styles.practiceScenarioButtonText, { color: activeTheme.titleText }]}>
                {selectedScenario
                  ? `Practice Scenario: ${selectedScenario.title}`
                  : "Practice Scenario"}
              </Text>
              <Text style={[styles.practiceScenarioButtonHint, { color: activeTheme.subtitleText }]}>
                {showScenarioPicker ? "Hide options" : "Choose a conversation context"}
              </Text>
            </Pressable>

            {showScenarioPicker ? (
              <View style={styles.practiceScenarioCards}>
                {PRACTICE_SCENARIOS.map((scenario) => {
                  const isActive = selectedScenario?.id === scenario.id;
                  return (
                    <Pressable
                      key={scenario.id}
                      style={[
                        styles.practiceScenarioCard,
                        {
                          backgroundColor: activeTheme.surfaceTint,
                          borderColor: activeTheme.surfaceBorder,
                        },
                        isActive && {
                          borderColor: activeTheme.messageAccentText,
                        },
                      ]}
                      onPress={() => handleSelectScenario(scenario)}
                    >
                      <Text style={[styles.practiceScenarioCardTitle, { color: activeTheme.titleText }]}>
                        {scenario.title}
                      </Text>
                      <Text style={[styles.practiceScenarioCardDescription, { color: activeTheme.subtitleText }]}>
                        {scenario.description}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>

          {selectedScenario ? (
            <View
              style={[
                styles.relevantVocabPanel,
                {
                  backgroundColor: activeTheme.surfaceTint,
                  borderColor: activeTheme.surfaceBorder,
                },
              ]}
            >
              <Text style={[styles.relevantVocabTitle, { color: activeTheme.titleText }]}>
                Relevant vocab · {selectedScenario.title}
              </Text>
              {selectedScenario.vocab.map((word) => (
                <View key={`${selectedScenario.id}-${word.chinese}`} style={styles.relevantVocabRow}>
                  <Text style={[styles.relevantVocabChinese, { color: activeTheme.titleText }]}>
                    {word.chinese}
                  </Text>
                  <Text style={[styles.relevantVocabPinyin, { color: activeTheme.messageAccentText }]}>
                    {word.pinyin}
                  </Text>
                  <Text style={[styles.relevantVocabEnglish, { color: activeTheme.subtitleText }]}>
                    {word.english}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {voiceTurn ? (
            <View
              style={[
                styles.voiceResultCenter,
                {
                  backgroundColor: activeTheme.surfaceTint,
                  borderColor: activeTheme.surfaceBorder,
                },
              ]}
            >
              <Text style={[styles.voiceResultChinese, { color: activeTheme.titleText }]}>
                {voiceTurn.chinese}
              </Text>
              <Text style={[styles.voiceResultPinyin, { color: activeTheme.messageAccentText }]}>
                {voiceTurn.pinyin}
              </Text>
              <Text style={[styles.voiceResultEnglish, { color: activeTheme.subtitleText }]}>
                {voiceTurn.transcript}
              </Text>
              {voiceTurn.notes?.length ? (
                <Text style={[styles.voiceResultNote, { color: activeTheme.voiceSupportText }]}>
                  {voiceTurn.notes[0]}
                </Text>
              ) : null}
            </View>
          ) : (
            <View style={styles.dailyPhrase}>
              <Text style={[styles.dailyPhraseChinese, { color: activeTheme.titleText }]}>
                {getDailyPhrase().chinese}
              </Text>
              <Text style={[styles.dailyPhrasePinyin, { color: activeTheme.messageAccentText }]}>
                {getDailyPhrase().pinyin}
              </Text>
              <Text style={[styles.dailyPhraseEnglish, { color: activeTheme.subtitleText }]}>
                {getDailyPhrase().english}
              </Text>
            </View>
          )}

          <Animated.View
            style={[
              styles.micStageWrap,
              {
                opacity: stageTransitionOpacity,
                transform: [{ translateY: stageTransitionTranslateY }],
              },
            ]}
          >
            <VoiceStage
              state={voiceStageState}
              mode={selectedVoice}
              preference={preference}
              onPressIn={() => {
                void startRecording();
              }}
              onPressOut={() => {
                void stopRecording();
              }}
              disabled={isUploadingVoice || micPermission === "denied"}
            />
          </Animated.View>

          {voiceHistory.length ? (
            <View style={styles.voiceHistoryWrap}>
              {voiceHistory.map((exchange) => (
                <View
                  key={exchange.id}
                  style={[
                    styles.voiceHistoryBubble,
                    {
                      backgroundColor: activeTheme.surfaceTint,
                      borderColor: activeTheme.surfaceBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.voiceHistoryUserLabel,
                      { color: activeTheme.voiceSupportText },
                    ]}
                  >
                    You said
                  </Text>
                  <Text
                    style={[
                      styles.voiceHistoryUserText,
                      { color: activeTheme.titleText },
                    ]}
                  >
                    {exchange.userTranscript}
                  </Text>
                  <Text
                    style={[
                      styles.voiceHistoryTutorLabel,
                      { color: activeTheme.voiceSupportText },
                    ]}
                  >
                    Tutor replied
                  </Text>
                  <Text
                    style={[
                      styles.voiceHistoryTutorChinese,
                      { color: activeTheme.titleText },
                    ]}
                  >
                    {exchange.tutorChinese}
                  </Text>
                  <Text
                    style={[
                      styles.voiceHistoryTutorPinyin,
                      { color: activeTheme.messageAccentText },
                    ]}
                  >
                    {exchange.tutorPinyin}
                  </Text>
                  <Text
                    style={[
                      styles.voiceHistoryTutorEnglish,
                      { color: activeTheme.subtitleText },
                    ]}
                  >
                    {exchange.tutorEnglish}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View> : null}
      </KeyboardAvoidingView>
      <Modal
        visible={showDrawer}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDrawer(false)}
      >
        <Pressable style={styles.drawerOverlay} onPress={() => setShowDrawer(false)}>
          <View style={styles.drawerPanel}>
            {DEMO_MODE || CHATBOT_ONLY_MODE || !REQUIRE_AUTH ? (
              <Text style={styles.drawerEmpty}>Settings coming soon</Text>
            ) : (
              <Pressable
                onPress={() => {
                  setShowDrawer(false);
                  void handleLogout();
                }}
              >
                <Text style={styles.drawerItem}>Logout</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FDF8F2",
  },
  practiceScenarioWrap: {
    width: "100%",
    marginBottom: 12,
  },
  practiceScenarioButton: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  practiceScenarioButtonText: {
    fontSize: 15,
    fontWeight: "700",
  },
  practiceScenarioButtonHint: {
    fontSize: 12,
    fontWeight: "500",
  },
  practiceScenarioCards: {
    marginTop: 10,
    gap: 8,
  },
  practiceScenarioCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  practiceScenarioCardTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  practiceScenarioCardDescription: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
  },
  relevantVocabPanel: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  relevantVocabTitle: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 8,
  },
  relevantVocabRow: {
    marginTop: 6,
  },
  relevantVocabChinese: {
    fontSize: 16,
    fontWeight: "700",
  },
  relevantVocabPinyin: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: "600",
  },
  relevantVocabEnglish: {
    marginTop: 1,
    fontSize: 13,
    fontWeight: "500",
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
    overflow: "hidden",
  },
  ambientBlobSecondary: {
    position: "absolute",
    width: 460,
    height: 460,
    borderRadius: 460,
    bottom: -170,
    left: -150,
    opacity: 0.62,
    overflow: "hidden",
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
    paddingTop: 16,
    paddingBottom: 0,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.07)",
  },
  headerTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerWordmark: {
    fontSize: 22,
    fontWeight: "500",
    fontStyle: "italic",
    color: "#1A1009",
    letterSpacing: 0.1,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  langPillContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.05)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 4,
  },
  langPillSide: {
    fontFamily: Platform.select({ ios: "Courier New", android: "monospace", default: "monospace" }),
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: "#8F8578",
  },
  langPillSideActive: {
    color: "#1D4D3B",
  },
  langPillSeparator: {
    fontFamily: Platform.select({ ios: "Courier New", android: "monospace", default: "monospace" }),
    fontSize: 11,
    color: "#8F8578",
  },
  menuButton: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  menuIcon: {
    fontSize: 22,
    color: "#1A1009",
    lineHeight: 26,
  },
  tabBar: {
    flexDirection: "row",
    marginTop: 14,
    gap: 20,
  },
  tabItem: {
    paddingBottom: 8,
    position: "relative",
  },
  tabLabel: {
    fontFamily: Platform.select({ ios: "Courier New", android: "monospace", default: "monospace" }),
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: "#8F8578",
  },
  tabLabelActive: {
    color: "#1D4D3B",
  },
  tabUnderline: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: "#1D4D3B",
    borderRadius: 1,
  },
  tabPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  tabPlaceholderText: {
    fontSize: 16,
    color: "#8F8578",
    fontFamily: Platform.select({ ios: "Courier New", android: "monospace", default: "monospace" }),
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  logoutText: {
    fontSize: 12,
    color: "#B91C1C",
    fontWeight: "600",
  },
  drawerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.28)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
  },
  drawerPanel: {
    backgroundColor: "#FDFAF6",
    marginTop: 88,
    marginRight: 16,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minWidth: 180,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  drawerItem: {
    fontSize: 15,
    fontWeight: "600",
    color: "#B91C1C",
    paddingVertical: 8,
  },
  drawerEmpty: {
    fontSize: 13,
    color: "#8F8578",
    paddingVertical: 8,
  },
  centerStage: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  dailyPhrase: {
    alignItems: "center",
    marginBottom: 48,
  },
  dailyPhraseChinese: {
    fontSize: 42,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  dailyPhrasePinyin: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: "500",
  },
  dailyPhraseEnglish: {
    marginTop: 6,
    fontSize: 16,
    fontWeight: "400",
  },
  voiceResultCenter: {
    alignItems: "center",
    marginBottom: 48,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 20,
    width: "100%",
    maxWidth: 340,
  },
  voiceResultChinese: {
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  voiceResultPinyin: {
    marginTop: 6,
    fontSize: 17,
    fontWeight: "500",
    textAlign: "center",
  },
  voiceResultEnglish: {
    marginTop: 6,
    fontSize: 15,
    textAlign: "center",
  },
  voiceResultNote: {
    marginTop: 10,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  micStageWrap: {
    alignItems: "center",
  },
  voiceHistoryWrap: {
    width: "100%",
    marginTop: 14,
    gap: 10,
  },
  voiceHistoryBubble: {
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  voiceHistoryUserLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  voiceHistoryUserText: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 3,
  },
  voiceHistoryTutorLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 10,
  },
  voiceHistoryTutorChinese: {
    fontSize: 18,
    fontWeight: "700",
    marginTop: 4,
  },
  voiceHistoryTutorPinyin: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 2,
  },
  voiceHistoryTutorEnglish: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  errorBanner: {
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorText: {
    color: "#B91C1C",
    fontSize: 12,
    textAlign: "center",
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
