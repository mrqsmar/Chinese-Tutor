import { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

export type VoiceStageState = "idle" | "listening" | "processing" | "speaking";

type VoiceStageProps = {
  state: VoiceStageState;
  onPressIn: () => void;
  onPressOut: () => void;
  disabled?: boolean;
  size?: number;
};

const statusTextByState: Record<VoiceStageState, string> = {
  idle: "Tap and hold to speak",
  listening: "Listening...",
  processing: "Generating reply...",
  speaking: "Playing pronunciation...",
};

const VoiceStage = ({
  state,
  onPressIn,
  onPressOut,
  disabled = false,
  size = 64,
}: VoiceStageProps) => {
  const breathing = useRef(new Animated.Value(0)).current;
  const pressScale = useRef(new Animated.Value(0)).current;
  const ringPulse = useRef(new Animated.Value(0)).current;
  const ringSpin = useRef(new Animated.Value(0)).current;
  const speakingShimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathing, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(breathing, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breathing]);

  useEffect(() => {
    Animated.spring(pressScale, {
      toValue: state === "listening" ? 1 : 0,
      friction: 7,
      tension: 180,
      useNativeDriver: true,
    }).start();
  }, [pressScale, state]);

  useEffect(() => {
    if (state !== "listening") {
      ringPulse.stopAnimation();
      ringPulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ringPulse, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.timing(ringPulse, {
          toValue: 0.2,
          duration: 360,
          useNativeDriver: true,
          easing: Easing.in(Easing.quad),
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [ringPulse, state]);

  useEffect(() => {
    if (state !== "processing") {
      ringSpin.stopAnimation();
      ringSpin.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.timing(ringSpin, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
        easing: Easing.linear,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [ringSpin, state]);

  useEffect(() => {
    if (state !== "speaking") {
      speakingShimmer.stopAnimation();
      speakingShimmer.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.timing(speakingShimmer, {
        toValue: 1,
        duration: 760,
        useNativeDriver: true,
        easing: Easing.inOut(Easing.sin),
      })
    );
    loop.start();
    return () => loop.stop();
  }, [speakingShimmer, state]);

  const orbScale = pressScale.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.04],
  });

  const glowOpacity = Animated.add(
    breathing.interpolate({
      inputRange: [0, 1],
      outputRange: [0.24, 0.4],
    }),
    pressScale.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.25],
    })
  );

  const ringScale = ringPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.11],
  });

  const spin = ringSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const shimmerTranslate = speakingShimmer.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 1, 0],
  });

  const statusText = useMemo(() => statusTextByState[state], [state]);
  const ringSize = size + 18;

  return (
    <View style={styles.container}>
      <Pressable
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={disabled}
        style={styles.pressable}
      >
        <View style={[styles.orbShell, { width: size + 20, height: size + 20 }]}>
          <Animated.View
            style={[
              styles.ambientGlow,
              {
                width: size + 26,
                height: size + 26,
                opacity: glowOpacity,
                transform: [{ scale: breathing.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.09],
                }) }],
              },
            ]}
          />

          {state === "listening" ? (
            <Animated.View
              style={[
                styles.listeningRing,
                {
                  width: ringSize,
                  height: ringSize,
                  transform: [{ scale: ringScale }],
                },
              ]}
            />
          ) : null}

          {state === "processing" ? (
            <Animated.View
              style={[
                styles.processingRing,
                {
                  width: ringSize,
                  height: ringSize,
                  transform: [{ rotate: spin }],
                },
              ]}
            />
          ) : null}

          {state === "speaking" ? (
            <View style={[styles.segmentRing, { width: ringSize, height: ringSize }]}>
              {[0, 1, 2, 3].map((segment) => (
                <Animated.View
                  key={segment}
                  style={[
                    styles.speakingSegment,
                    {
                      transform: [
                        { rotate: `${segment * 90}deg` },
                        { translateY: shimmerTranslate.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, segment % 2 === 0 ? -1.5 : 1.5],
                        }) },
                      ],
                      opacity: speakingShimmer.interpolate({
                        inputRange: [0, 0.5, 1],
                        outputRange: [0.35, 1, 0.35],
                      }),
                    },
                  ]}
                />
              ))}
            </View>
          ) : null}

          <Animated.View
            style={[
              styles.orb,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                transform: [{ scale: orbScale }],
              },
            ]}
          >
            <View style={styles.orbHighlight} />
            <View style={styles.orbInnerCore} />
          </Animated.View>
        </View>
      </Pressable>
      <Text style={styles.statusText}>{statusText}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 14,
    alignItems: "center",
  },
  pressable: {
    alignItems: "center",
    justifyContent: "center",
  },
  orbShell: {
    alignItems: "center",
    justifyContent: "center",
  },
  ambientGlow: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "#58D5FF55",
    shadowColor: "#7E5CFF",
    shadowOpacity: 0.8,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  orb: {
    backgroundColor: "#FFFFFF2E",
    borderWidth: 1,
    borderColor: "#FFFFFF77",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#5CE1FF",
    shadowOpacity: 0.42,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 7,
  },
  orbHighlight: {
    position: "absolute",
    width: "100%",
    height: "50%",
    top: 0,
    backgroundColor: "#FFFFFF44",
  },
  orbInnerCore: {
    width: "52%",
    height: "52%",
    borderRadius: 999,
    backgroundColor: "#A8F2FF44",
    borderWidth: 1,
    borderColor: "#C8B8FF66",
  },
  listeningRing: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#64E9FF",
    shadowColor: "#6FD6FF",
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  processingRing: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 2,
    borderTopColor: "#59DEFF",
    borderRightColor: "#8263FF",
    borderBottomColor: "#59DEFF22",
    borderLeftColor: "#8263FF22",
  },
  segmentRing: {
    position: "absolute",
    justifyContent: "center",
    alignItems: "center",
  },
  speakingSegment: {
    position: "absolute",
    width: "72%",
    height: 2,
    borderRadius: 999,
    backgroundColor: "#7FD2FF",
    shadowColor: "#8A6BFF",
    shadowOpacity: 0.9,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  statusText: {
    marginTop: 14,
    fontSize: 13,
    color: "#CDE5FF",
    fontWeight: "500",
    letterSpacing: 0.2,
  },
});

export default VoiceStage;
