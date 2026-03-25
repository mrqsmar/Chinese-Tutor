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
  size = 68,
}: VoiceStageProps) => {
  const breathing = useRef(new Animated.Value(0)).current;
  const pressScale = useRef(new Animated.Value(0)).current;
  const stateBoost = useRef(new Animated.Value(0)).current;
  const ringPulse = useRef(new Animated.Value(0)).current;
  const ringSpin = useRef(new Animated.Value(0)).current;
  const speakingShimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathing, {
          toValue: 1,
          duration: 1650,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.cubic),
        }),
        Animated.timing(breathing, {
          toValue: 0,
          duration: 1850,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.cubic),
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breathing]);

  useEffect(() => {
    Animated.spring(pressScale, {
      toValue: state === "listening" ? 1 : 0,
      friction: 6,
      tension: 210,
      useNativeDriver: true,
    }).start();
  }, [pressScale, state]);

  useEffect(() => {
    Animated.spring(stateBoost, {
      toValue: state === "idle" ? 0 : 1,
      friction: 8,
      tension: 170,
      useNativeDriver: true,
    }).start();
  }, [state, stateBoost]);

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
          duration: 260,
          useNativeDriver: true,
          easing: Easing.out(Easing.exp),
        }),
        Animated.timing(ringPulse, {
          toValue: 0.15,
          duration: 420,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
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
      Animated.sequence([
        Animated.timing(ringSpin, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.timing(ringSpin, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
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
        duration: 620,
        useNativeDriver: true,
        easing: Easing.inOut(Easing.ease),
      })
    );
    loop.start();
    return () => loop.stop();
  }, [speakingShimmer, state]);

  const orbScale = pressScale.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.04],
  });

  const baseGlow = breathing.interpolate({
    inputRange: [0, 1],
    outputRange: [0.34, 0.62],
  });

  const glowOpacity = Animated.add(
    Animated.add(
      baseGlow,
      pressScale.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 0.2],
      })
    ),
    stateBoost.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.14],
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
  const shellScale = stateBoost.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.02],
  });

  return (
    <View style={styles.container}>
      <Pressable
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={disabled}
        style={styles.pressable}
      >
        <Animated.View
          style={[
            styles.orbShell,
            { width: size + 22, height: size + 22, transform: [{ scale: shellScale }] },
          ]}
        >
          <Animated.View
            style={[
              styles.ambientGlowCyan,
              {
                width: size + 34,
                height: size + 34,
                opacity: glowOpacity,
                transform: [
                  {
                    scale: breathing.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1.02, 1.18],
                    }),
                  },
                ],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.ambientGlowViolet,
              {
                width: size + 28,
                height: size + 28,
                opacity: glowOpacity,
                transform: [
                  {
                    scale: breathing.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.12],
                    }),
                  },
                ],
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
                        {
                          scaleX: shimmerTranslate.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.72, segment % 2 === 0 ? 1.22 : 1.02],
                          }),
                        },
                        {
                          translateY: shimmerTranslate.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, segment % 2 === 0 ? -1.8 : 1.8],
                          }),
                        },
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
            <View style={styles.orbAccent} />
            <View style={styles.orbInnerCore} />
          </Animated.View>
        </Animated.View>
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
  ambientGlowCyan: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "#4DE9FF66",
    shadowColor: "#4BDFFF",
    shadowOpacity: 0.95,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  ambientGlowViolet: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "#7D5BFF55",
    shadowColor: "#8A6BFF",
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  orb: {
    backgroundColor: "#FFFFFF30",
    borderWidth: 1,
    borderColor: "#FFFFFF88",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#6BE0FF",
    shadowOpacity: 0.58,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  orbHighlight: {
    position: "absolute",
    width: "100%",
    height: "52%",
    top: 0,
    backgroundColor: "#FFFFFF55",
  },
  orbAccent: {
    position: "absolute",
    width: "90%",
    height: "90%",
    borderRadius: 999,
    backgroundColor: "#71E5FF22",
    borderWidth: 1,
    borderColor: "#9D8BFF33",
  },
  orbInnerCore: {
    width: "56%",
    height: "56%",
    borderRadius: 999,
    backgroundColor: "#A8F2FF5C",
    borderWidth: 1,
    borderColor: "#D4C8FF88",
  },
  listeningRing: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 2.4,
    borderColor: "#64E9FF",
    shadowColor: "#6FD6FF",
    shadowOpacity: 0.7,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  processingRing: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 2.5,
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
    width: "68%",
    height: 2.4,
    borderRadius: 999,
    backgroundColor: "#87DAFF",
    shadowColor: "#8A6BFF",
    shadowOpacity: 0.9,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  statusText: {
    marginTop: 14,
    fontSize: 13,
    color: "#D7E7FF",
    fontWeight: "600",
    letterSpacing: 0.3,
  },
});

export default VoiceStage;
