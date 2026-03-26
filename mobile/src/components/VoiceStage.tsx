import { useEffect, useMemo, useRef } from "react";
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

const statusTextByState: Record<VoiceStageState, string> = {
  idle: "Tap and hold to speak",
  listening: "Listening...",
  processing: "Translating...",
  speaking: "Playing pronunciation...",
  complete: "Complete ✓",
};

const modeToNumeric = (mode: VoiceTone) =>
  mode === "warm" ? 0 : mode === "bright" ? 1 : 2;

const stateToNumeric = (state: VoiceStageState) => {
  if (state === "idle") {
    return 0;
  }
  if (state === "listening") {
    return 1;
  }
  if (state === "processing") {
    return 2;
  }
  if (state === "speaking") {
    return 3;
  }
  return 4;
};

const VoiceStage = ({
  state,
  mode,
  onPressIn,
  onPressOut,
  disabled = false,
  size = 64,
}: VoiceStageProps) => {
  // Native-driver-only values (opacity/transform only)
  const stateNative = useRef(new Animated.Value(stateToNumeric(state))).current;
  const modeNative = useRef(new Animated.Value(modeToNumeric(mode))).current;
  const breathingNative = useRef(new Animated.Value(0)).current;
  const pressNative = useRef(new Animated.Value(0)).current;
  const listeningRingNative = useRef(new Animated.Value(0)).current;
  const processingSpinNative = useRef(new Animated.Value(0)).current;
  const speakingWaveNative = useRef(new Animated.Value(0)).current;

  // JS-driver-only values (color interpolation and any non-native compatible math)
  const modeColor = useRef(new Animated.Value(modeToNumeric(mode))).current;
  const glowBoostColor = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(stateNative, {
      toValue: stateToNumeric(state),
      duration: 280,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [state, stateNative]);

  useEffect(() => {
    Animated.timing(modeNative, {
      toValue: modeToNumeric(mode),
      duration: 620,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [mode, modeNative]);

  useEffect(() => {
    Animated.timing(modeColor, {
      toValue: modeToNumeric(mode),
      duration: 620,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [mode, modeColor]);

  useEffect(() => {
    const inhaleExhaleDuration =
      mode === "bright" ? 1200 : mode === "warm" ? 2200 : 2800;

    breathingNative.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathingNative, {
          toValue: 1,
          duration: inhaleExhaleDuration,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(breathingNative, {
          toValue: 0,
          duration: inhaleExhaleDuration,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ])
    );

    loop.start();
    return () => {
      loop.stop();
      breathingNative.stopAnimation();
    };
  }, [mode, breathingNative]);

  useEffect(() => {
    Animated.spring(pressNative, {
      toValue: state === "listening" ? 1 : 0,
      friction: 7,
      tension: 180,
      useNativeDriver: true,
    }).start();
  }, [state, pressNative]);

  useEffect(() => {
    Animated.spring(glowBoostColor, {
      toValue: state === "listening" ? 1 : 0,
      friction: 8,
      tension: 170,
      useNativeDriver: false,
    }).start();
  }, [state, glowBoostColor]);

  useEffect(() => {
    if (state !== "listening") {
      listeningRingNative.stopAnimation();
      listeningRingNative.setValue(0);
      return;
    }

    const riseDuration = mode === "bright" ? 280 : mode === "warm" ? 460 : 560;
    const settleDuration = mode === "bright" ? 220 : mode === "warm" ? 380 : 540;
    const settleFloor = mode === "bright" ? 0.12 : mode === "warm" ? 0.2 : 0.28;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(listeningRingNative, {
          toValue: 1,
          duration: riseDuration,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.timing(listeningRingNative, {
          toValue: settleFloor,
          duration: settleDuration,
          useNativeDriver: true,
          easing: Easing.in(Easing.quad),
        }),
      ])
    );

    loop.start();
    return () => {
      loop.stop();
      listeningRingNative.stopAnimation();
    };
  }, [state, mode, listeningRingNative]);

  useEffect(() => {
    if (state !== "processing") {
      processingSpinNative.stopAnimation();
      processingSpinNative.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.timing(processingSpinNative, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
        easing: Easing.linear,
      })
    );

    loop.start();
    return () => {
      loop.stop();
      processingSpinNative.stopAnimation();
    };
  }, [state, processingSpinNative]);

  useEffect(() => {
    if (state !== "speaking") {
      speakingWaveNative.stopAnimation();
      speakingWaveNative.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.timing(speakingWaveNative, {
        toValue: 1,
        duration: 760,
        useNativeDriver: true,
        easing: Easing.inOut(Easing.sin),
      })
    );

    loop.start();
    return () => {
      loop.stop();
      speakingWaveNative.stopAnimation();
    };
  }, [state, speakingWaveNative]);

  const statusText = useMemo(() => statusTextByState[state], [state]);
  const ringSize = size + 18;

  const orbPressScale = pressNative.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.04],
  });

  const breathingScaleByMode = modeNative.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [1.07, 1.11, 1.05],
  });
  const ambientGlowScale = Animated.add(
    1,
    Animated.multiply(breathingNative, Animated.subtract(breathingScaleByMode, 1))
  );

  const motionLiftByMode = modeNative.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [1.4, 2.3, 2.8],
  });

  const orbFloat = breathingNative.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -1],
  });

  const listeningRingScale = listeningRingNative.interpolate({
    inputRange: [0, 1],
    outputRange: [1, mode === "bright" ? 1.16 : mode === "warm" ? 1.1 : 1.08],
  });

  const processingSpin = processingSpinNative.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const speakingWaveTranslate = speakingWaveNative.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 1, 0],
  });

  const speakingWaveOpacity = speakingWaveNative.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.35, 1, 0.35],
  });

  // Color and non-native interpolations live only on modeColor / glowBoostColor
  const primaryGradientColor = modeColor.interpolate({
    inputRange: [0, 1, 2],
    outputRange: ["#FF9A43", "#42E8FF", "#8E63FF"],
  });

  const secondaryGradientColor = modeColor.interpolate({
    inputRange: [0, 1, 2],
    outputRange: ["#FF6E67", "#2E71FF", "#4A3BBD"],
  });

  const orbBorderColor = modeColor.interpolate({
    inputRange: [0, 1, 2],
    outputRange: ["#FFD2AC88", "#B0F3FF99", "#D7CBFF88"],
  });

  const glowColor = modeColor.interpolate({
    inputRange: [0, 1, 2],
    outputRange: ["#FF8A5D", "#42D7FF", "#6C54D6"],
  });

  const ringAccentColor = modeColor.interpolate({
    inputRange: [0, 1, 2],
    outputRange: ["#FFB27C", "#7AF4FF", "#A58BFF"],
  });

  const ambientGlowOpacityBase = modeColor.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [0.4, 0.54, 0.28],
  });

  const ambientGlowOpacity = Animated.add(
    ambientGlowOpacityBase,
    glowBoostColor.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.2],
    })
  );

  const ambientPulseOpacity = Animated.add(
    breathingNative.interpolate({
      inputRange: [0, 1],
      outputRange: [0.18, 0.32],
    }),
    pressNative.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.1],
    })
  );

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
              opacity: stateNative.interpolate({
                inputRange: [0, 1, 2, 3, 4],
                outputRange: [0.08, 0.16, 0.2, 0.14, 0.22],
              }),
              transform: [
                {
                  scale: stateNative.interpolate({
                    inputRange: [0, 1, 2, 3, 4],
                    outputRange: [1, 1.03, 1.04, 1.02, 1.05],
                  }),
                },
              ],
            }}
          />

          <Animated.View
            style={[
              styles.ambientGlowBase,
              {
                width: size + 26,
                height: size + 26,
                backgroundColor: glowColor,
                opacity: ambientGlowOpacity,
                transform: [{ scale: orbPressScale }],
              },
            ]}
          />

          <Animated.View
            pointerEvents="none"
            style={[
              styles.ambientGlowPulse,
              {
                width: size + 34,
                height: size + 34,
                opacity: ambientPulseOpacity,
                transform: [{ scale: ambientGlowScale }],
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
                  transform: [{ scale: listeningRingScale }],
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
                  borderBottomColor: modeColor.interpolate({
                    inputRange: [0, 1, 2],
                    outputRange: ["#FFB27A22", "#77EEFF22", "#9B84FF22"],
                  }),
                  borderLeftColor: modeColor.interpolate({
                    inputRange: [0, 1, 2],
                    outputRange: ["#FF866422", "#3B78FF22", "#5B49C622"],
                  }),
                  transform: [{ rotate: processingSpin }],
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
                      transform: [
                        { rotate: `${segment * 90}deg` },
                        {
                          translateY: speakingWaveTranslate.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, segment % 2 === 0 ? -1.5 : 1.5],
                          }),
                        },
                      ],
                      opacity: speakingWaveOpacity,
                    },
                  ]}
                />
              ))}
            </View>
          ) : null}

          {state === "complete" ? (
            <Animated.View
              style={[
                styles.completeRing,
                {
                  width: ringSize - 2,
                  height: ringSize - 2,
                  borderColor: ringAccentColor,
                  opacity: stateNative.interpolate({
                    inputRange: [3, 4],
                    outputRange: [0.2, 0.85],
                  }),
                  transform: [
                    {
                      scale: stateNative.interpolate({
                        inputRange: [3, 4],
                        outputRange: [0.96, 1.02],
                      }),
                    },
                  ],
                },
              ]}
            />
          ) : null}

          <Animated.View
            style={[
              styles.orb,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                borderColor: orbBorderColor,
                transform: [
                  { scale: orbPressScale },
                  { translateY: Animated.multiply(orbFloat, motionLiftByMode) },
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
                  opacity: modeColor.interpolate({
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
                  backgroundColor: modeColor.interpolate({
                    inputRange: [0, 1, 2],
                    outputRange: ["#FFF3DF66", "#D7FBFF6B", "#D7CDFF5E"],
                  }),
                  borderColor: modeColor.interpolate({
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
          state === "idle" ? styles.statusTextIdle : null,
          {
            opacity: stateNative.interpolate({
              inputRange: [0, 1, 2, 3, 4],
              outputRange: [0.9, 1, 0.96, 0.94, 1],
            }),
            transform: [
              {
                translateY: stateNative.interpolate({
                  inputRange: [0, 1, 2, 3, 4],
                  outputRange: [0, -1, -1, 0, -1],
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
  ambientGlowBase: {
    position: "absolute",
    borderRadius: 999,
  },
  ambientGlowPulse: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
  },
  orb: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOpacity: 0.34,
    shadowRadius: 16,
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
    shadowColor: "#FFFFFF",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  processingRing: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 2,
  },
  completeRing: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 2,
    shadowColor: "#FFFFFF",
    shadowOpacity: 0.25,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 0 },
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
  },
  statusText: {
    marginTop: 14,
    fontSize: 13,
    color: "#6B7280",
    fontWeight: "500",
    letterSpacing: 0.2,
  },
  statusTextIdle: {
    color: "#27272A",
    fontWeight: "600",
  },
});

export default VoiceStage;
