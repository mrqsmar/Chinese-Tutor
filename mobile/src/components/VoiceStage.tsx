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
export type VoiceTone = "warm" | "bright" | "deep";

type VoiceStageProps = {
  state: VoiceStageState;
  mode: VoiceTone;
  onPressIn: () => void;
  onPressOut: () => void;
  disabled?: boolean;
  size?: number;
};

const statusTextByState: Record<VoiceStageState, string> = {
  idle: "Tap and hold to speak",
  listening: "Listening...",
  processing: "Thinking...",
  speaking: "Playing pronunciation...",
};

const VoiceStage = ({
  state,
  mode,
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
  const stateMorph = useRef(new Animated.Value(0)).current;
  const modeTransition = useRef(
    new Animated.Value(mode === "warm" ? 0 : mode === "bright" ? 1 : 2)
  ).current;

  useEffect(() => {
    const nextState =
      state === "idle" ? 0 : state === "listening" ? 1 : state === "processing" ? 2 : 3;
    Animated.timing(stateMorph, {
      toValue: nextState,
      duration: 280,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [state, stateMorph]);

  useEffect(() => {
    const targetMode = mode === "warm" ? 0 : mode === "bright" ? 1 : 2;
    Animated.timing(modeTransition, {
      toValue: targetMode,
      duration: 620,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [mode, modeTransition]);

  useEffect(() => {
    const inhaleExhaleDuration =
      mode === "bright" ? 1200 : mode === "warm" ? 2200 : 2800;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathing, {
          toValue: 1,
          duration: inhaleExhaleDuration,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(breathing, {
          toValue: 0,
          duration: inhaleExhaleDuration,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breathing, mode]);

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

    const riseDuration = mode === "bright" ? 280 : mode === "warm" ? 460 : 560;
    const settleDuration = mode === "bright" ? 220 : mode === "warm" ? 380 : 540;
    const settleFloor = mode === "bright" ? 0.12 : mode === "warm" ? 0.2 : 0.28;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ringPulse, {
          toValue: 1,
          duration: riseDuration,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.timing(ringPulse, {
          toValue: settleFloor,
          duration: settleDuration,
          useNativeDriver: true,
          easing: Easing.in(Easing.quad),
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [mode, ringPulse, state]);

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

  const breathingScaleRange = modeTransition.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [1.07, 1.11, 1.05],
  });
  const ambientScale = Animated.add(
    1,
    Animated.multiply(breathing, Animated.subtract(breathingScaleRange, 1))
  );

  const motionLift = modeTransition.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [1.4, 2.3, 2.8],
  });

  const orbTranslateY = breathing.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -1],
  });

  const primaryGradientColor = modeTransition.interpolate({
    inputRange: [0, 1, 2],
    outputRange: ["#FF9A43", "#42E8FF", "#8E63FF"],
  });

  const secondaryGradientColor = modeTransition.interpolate({
    inputRange: [0, 1, 2],
    outputRange: ["#FF6E67", "#2E71FF", "#4A3BBD"],
  });

  const orbBorderColor = modeTransition.interpolate({
    inputRange: [0, 1, 2],
    outputRange: ["#FFD2AC88", "#B0F3FF99", "#D7CBFF88"],
  });

  const glowColor = modeTransition.interpolate({
    inputRange: [0, 1, 2],
    outputRange: ["#FF8A5D", "#42D7FF", "#6C54D6"],
  });

  const ringAccentColor = modeTransition.interpolate({
    inputRange: [0, 1, 2],
    outputRange: ["#FFB27C", "#7AF4FF", "#A58BFF"],
  });

  const glowOpacityByMode = modeTransition.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [0.4, 0.54, 0.28],
  });

  const glowShadowRadiusByMode = modeTransition.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [22, 14, 9],
  });

  const glowOpacity = Animated.add(
    glowOpacityByMode,
    pressScale.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.2],
    })
  );

  const ringScale = ringPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, mode === "bright" ? 1.16 : mode === "warm" ? 1.1 : 1.08],
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
          pointerEvents="none"
          style={{
            position: "absolute",
            width: size + 30,
            height: size + 30,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.12)",
            opacity: stateMorph.interpolate({
              inputRange: [0, 1, 2, 3],
              outputRange: [0.08, 0.16, 0.2, 0.14],
            }),
            transform: [
              {
                scale: stateMorph.interpolate({
                  inputRange: [0, 1, 2, 3],
                  outputRange: [1, 1.03, 1.04, 1.02],
                }),
              },
            ],
          }}
        />
          <Animated.View
            style={[
              styles.ambientGlow,
              {
                width: size + 26,
                height: size + 26,
                backgroundColor: glowColor,
                shadowColor: glowColor,
                shadowRadius: glowShadowRadiusByMode,
                opacity: glowOpacity,
                transform: [
                  {
                    scale: ambientScale,
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
                  borderColor: ringAccentColor,
                  shadowColor: ringAccentColor,
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
                  borderTopColor: ringAccentColor,
                  borderRightColor: secondaryGradientColor,
                  borderBottomColor: modeTransition.interpolate({
                    inputRange: [0, 1, 2],
                    outputRange: ["#FFB27A22", "#77EEFF22", "#9B84FF22"],
                  }),
                  borderLeftColor: modeTransition.interpolate({
                    inputRange: [0, 1, 2],
                    outputRange: ["#FF866422", "#3B78FF22", "#5B49C622"],
                  }),
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
                      backgroundColor: ringAccentColor,
                      shadowColor: secondaryGradientColor,
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
                borderColor: orbBorderColor,
                shadowColor: glowColor,
                transform: [
                  { scale: orbScale },
                  {
                    translateY: Animated.multiply(orbTranslateY, motionLift),
                  },
                ],
              },
            ]}
          >
            <Animated.View
              style={[
                styles.gradientLayerTop,
                { backgroundColor: primaryGradientColor },
              ]}
            />
            <Animated.View
              style={[
                styles.gradientLayerBottom,
                { backgroundColor: secondaryGradientColor },
              ]}
            />
            <Animated.View
              style={[
                styles.orbHighlight,
                {
                  opacity: modeTransition.interpolate({
                    inputRange: [0, 1, 2],
                    outputRange: [0.34, 0.28, 0.22],
                  }),
                },
              ]}
            />
            <Animated.View
              style={[
                styles.orbInnerCore,
                {
                  backgroundColor: modeTransition.interpolate({
                    inputRange: [0, 1, 2],
                    outputRange: ["#FFF3DF66", "#D7FBFF6B", "#D7CDFF5E"],
                  }),
                  borderColor: modeTransition.interpolate({
                    inputRange: [0, 1, 2],
                    outputRange: ["#FFD5B277", "#BBF0FF8A", "#D7C5FF76"],
                  }),
                },
              ]}
            />
          </Animated.View>
        </View>
      </Pressable>
      <Animated.Text
        style={[
          styles.statusText,
          {
            opacity: stateMorph.interpolate({
              inputRange: [0, 1, 2, 3],
              outputRange: [0.9, 1, 0.96, 0.94],
            }),
            transform: [
              {
                translateY: stateMorph.interpolate({
                  inputRange: [0, 1, 2, 3],
                  outputRange: [0, -1, -1, 0],
                }),
              },
            ],
          },
        ]}
      >
        {statusText}
      </Animated.Text>
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
    shadowOpacity: 0.8,
    shadowOffset: { width: 0, height: 0 },
  },
  orb: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowOpacity: 0.42,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 7,
  },
  gradientLayerTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "55%",
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
  },
  gradientLayerBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "58%",
    borderBottomLeftRadius: 999,
    borderBottomRightRadius: 999,
  },
  orbHighlight: {
    position: "absolute",
    width: "100%",
    height: "50%",
    top: 0,
    backgroundColor: "#FFFFFF",
  },
  orbInnerCore: {
    width: "52%",
    height: "52%",
    borderRadius: 999,
    borderWidth: 1,
  },
  listeningRing: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 2,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  processingRing: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 2,
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
