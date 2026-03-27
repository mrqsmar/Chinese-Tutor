import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

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
  size?: number;
};

const MODE_COLORS: Record<VoiceTone, { bg: string; bgPress: string; border: string }> = {
  warm:   { bg: "#8F5A33", bgPress: "#6B3D20", border: "#7B4925" },
  bright: { bg: "#0369A1", bgPress: "#024E7A", border: "#075985" },
  deep:   { bg: "#5B21B6", bgPress: "#3D1491", border: "#4C1D95" },
};

const STATE_ICON: Record<VoiceStageState, string> = {
  idle:       "🎤",
  listening:  "⏹",
  processing: "⋯",
  speaking:   "🔊",
  complete:   "✓",
};

const STATE_LABEL: Record<VoiceStageState, string> = {
  idle:       "Hold to speak",
  listening:  "Listening…",
  processing: "Translating…",
  speaking:   "Playing…",
  complete:   "Done",
};

const VoiceStage = ({
  state,
  mode,
  onPressIn,
  onPressOut,
  disabled = false,
}: VoiceStageProps) => {
  const pressAnim  = useRef(new Animated.Value(0)).current;
  const pulseAnim  = useRef(new Animated.Value(1)).current;

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

  const { bg, bgPress, border } = MODE_COLORS[mode];
  const scale = pressAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] });

  return (
    <View style={styles.container}>
      <Animated.View style={{ transform: [{ scale }], opacity: pulseAnim }}>
        <Pressable
          style={[
            styles.pill,
            { backgroundColor: isListening ? bgPress : bg, borderColor: border },
          ]}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          disabled={disabled}
        >
          <Text style={styles.icon}>{STATE_ICON[state]}</Text>
          <Text style={styles.label}>{STATE_LABEL[state]}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 20,
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 999,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  icon: {
    fontSize: 18,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
});

export default VoiceStage;
