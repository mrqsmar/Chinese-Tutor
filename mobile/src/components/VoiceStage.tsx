import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

const MicIcon = ({ color = "white" }: { color?: string }) => (
  <View style={{ alignItems: "center" }}>
    <View style={{ width: 11, height: 18, borderRadius: 5.5, backgroundColor: color }} />
    <View style={{
      width: 20,
      height: 9,
      borderLeftWidth: 2,
      borderRightWidth: 2,
      borderBottomWidth: 2,
      borderColor: color,
      borderBottomLeftRadius: 10,
      borderBottomRightRadius: 10,
      marginTop: -2,
    }} />
    <View style={{ width: 11, height: 2, backgroundColor: color, marginTop: 2 }} />
  </View>
);

export type VoiceStageState =
  | "idle"
  | "listening"
  | "processing"
  | "speaking"
  | "complete";
export type VoiceTone = "warm" | "bright" | "deep";

type VoiceStageProps = {
  state: VoiceStageState;
  mode: VoiceTone;
  onPressIn: () => void;
  onPressOut: () => void;
  disabled?: boolean;
  preference?: "english" | "chinese" | null;
};

const MODE_COLORS: Record<VoiceTone, { bg: string; bgPress: string; border: string; ring: string }> = {
  warm:   { bg: "#8F5A33", bgPress: "#6B3D20", border: "#7B4925", ring: "rgba(143, 90, 51, 0.15)" },
  bright: { bg: "#0369A1", bgPress: "#024E7A", border: "#075985", ring: "rgba(3, 105, 161, 0.15)" },
  deep:   { bg: "#5B21B6", bgPress: "#3D1491", border: "#4C1D95", ring: "rgba(91, 33, 182, 0.15)" },
};

const STATE_ICON: Record<VoiceStageState, string> = {
  idle:       "🎤",
  listening:  "⏹",
  processing: "⋯",
  speaking:   "🔊",
  complete:   "✓",
};

const STATE_LABEL_EN: Record<VoiceStageState, string> = {
  idle:       "Hold to speak",
  listening:  "Listening…",
  processing: "Translating…",
  speaking:   "Playing…",
  complete:   "Done",
};

const STATE_LABEL_ZH: Record<VoiceStageState, string> = {
  idle:       "按住说话",
  listening:  "聆听中…",
  processing: "翻译中…",
  speaking:   "播放中…",
  complete:   "完成",
};

const BUTTON_SIZE = 76;

const VoiceStage = ({
  state,
  mode,
  onPressIn,
  onPressOut,
  disabled = false,
  preference,
}: VoiceStageProps) => {
  const STATE_LABEL = preference === "chinese" ? STATE_LABEL_ZH : STATE_LABEL_EN;
  const pressAnim  = useRef(new Animated.Value(0)).current;
  const pulseAnim  = useRef(new Animated.Value(1)).current;
  const ringAnim   = useRef(new Animated.Value(0)).current;
  const [hasEnoughRecording, setHasEnoughRecording] = useState(false);
  const enoughTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scale = useRef(pressAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] })).current;

  const isListening  = state === "listening";
  const isProcessing = state === "processing";

  useEffect(() => {
    Animated.spring(pressAnim, {
      toValue: isListening ? 1 : 0,
      friction: 7,
      tension: 180,
      useNativeDriver: true,
    }).start();
  }, [isListening, pressAnim]);

  useEffect(() => {
    if (isListening) {
      setHasEnoughRecording(false);
      Animated.timing(ringAnim, {
        toValue: 1,
        duration: 2000,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      enoughTimerRef.current = setTimeout(() => {
        setHasEnoughRecording(true);
      }, 2000);
      return () => {
        if (enoughTimerRef.current) {
          clearTimeout(enoughTimerRef.current);
          enoughTimerRef.current = null;
        }
      };
    }
    ringAnim.setValue(0);
    setHasEnoughRecording(false);
  }, [isListening, ringAnim]);

  useEffect(() => {
    if (!isProcessing) {
      pulseAnim.stopAnimation();
      Animated.timing(pulseAnim, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.65,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isProcessing, pulseAnim]);

  const { bg, bgPress, border, ring } = MODE_COLORS[mode];

  const ringScale = ringAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.9],
  });
  const ringOpacity = ringAnim.interpolate({
    inputRange: [0, 0.8, 1],
    outputRange: [0.55, 0.45, 0.35],
  });

  return (
    <View style={styles.container}>
      {isListening ? (
        <Animated.View
          style={[
            styles.ring,
            {
              backgroundColor: hasEnoughRecording ? "#22C55E" : ring,
              transform: [{ scale: ringScale }],
              opacity: ringOpacity,
            },
          ]}
        />
      ) : null}
      <Animated.View style={{ transform: [{ scale }], opacity: pulseAnim }}>
        <Pressable
          style={[
            styles.button,
            state === "idle"
              ? styles.buttonIdle
              : { backgroundColor: isListening ? bgPress : bg, borderColor: border },
            disabled && styles.buttonDisabled,
          ]}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          disabled={disabled}
        >
          {state === "idle" ? (
            <MicIcon color="white" />
          ) : (
            <Text style={styles.icon}>{STATE_ICON[state]}</Text>
          )}
        </Pressable>
      </Animated.View>
      {isProcessing ? (
        <Animated.Text
          style={[styles.label, styles.processingLabel, { color: bg, opacity: pulseAnim }]}
        >
          Thinking...
        </Animated.Text>
      ) : state === "idle" ? (
        <Text style={styles.idleLabel}>Hold · Speak · Release</Text>
      ) : (
        <Text style={[styles.label, { color: bg }]}>{STATE_LABEL[state]}</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonIdle: {
    backgroundColor: "#15110D",
    borderWidth: 0,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  icon: {
    fontSize: 28,
  },
  label: {
    marginTop: 14,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  idleLabel: {
    marginTop: 12,
    fontFamily: Platform.select({ ios: "Courier New", android: "monospace", default: "monospace" }),
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: "#8F8578",
  },
  processingLabel: {
    minWidth: 100,
    textAlign: "center",
  },
});

export default VoiceStage;
