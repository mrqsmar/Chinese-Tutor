import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, useMemo, useRef } from "react";

type StructuredLearningCardProps = {
  chinese: string;
  pinyin?: string;
  english: string;
  tip?: string;
  onTrySpeaking?: () => void;
};

const HAN_REGEX = /[\u3400-\u9FFF]/;

const sanitize = (value?: string) => value?.trim() ?? "";

export const parseLearningCard = (text: string) => {
  const normalized = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const taggedChinese = normalized.find((line) => /^chinese\s*:/i.test(line));
  const taggedPinyin = normalized.find((line) => /^pinyin\s*:/i.test(line));
  const taggedEnglish = normalized.find(
    (line) => /^(english|meaning|translation)\s*:/i.test(line)
  );
  const taggedTip = normalized.find((line) => /^tip\s*:/i.test(line));

  const chineseFromTag = taggedChinese?.replace(/^chinese\s*:/i, "").trim();
  const pinyinFromTag = taggedPinyin?.replace(/^pinyin\s*:/i, "").trim();
  const englishFromTag = taggedEnglish
    ?.replace(/^(english|meaning|translation)\s*:/i, "")
    .trim();
  const tipFromTag = taggedTip?.replace(/^tip\s*:/i, "").trim();

  const chineseFallback =
    normalized.find((line) => HAN_REGEX.test(line) && line.length <= 40) ?? "";

  const pinyinFallback = normalized.find(
    (line) =>
      !HAN_REGEX.test(line) &&
      /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i.test(line)
  );

  const englishFallback = normalized.find(
    (line) => !HAN_REGEX.test(line) && line !== pinyinFallback
  );

  return {
    chinese: sanitize(chineseFromTag) || sanitize(chineseFallback) || "学习短句",
    pinyin: sanitize(pinyinFromTag) || sanitize(pinyinFallback),
    english:
      sanitize(englishFromTag) ||
      sanitize(englishFallback) ||
      sanitize(text) ||
      "Let's learn this phrase.",
    tip: sanitize(tipFromTag),
  };
};

const StructuredLearningCard = ({
  chinese,
  pinyin,
  english,
  tip,
  onTrySpeaking,
}: StructuredLearningCardProps) => {
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 360,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  const cardStyle = useMemo(
    () => ({
      opacity: entrance,
      transform: [
        {
          translateY: entrance.interpolate({
            inputRange: [0, 1],
            outputRange: [12, 0],
          }),
        },
      ],
    }),
    [entrance]
  );

  return (
    <Animated.View style={[styles.card, cardStyle]}>
      <Text style={styles.chinese}>{chinese}</Text>
      {pinyin ? <Text style={styles.pinyin}>{pinyin}</Text> : null}
      <Text style={styles.english}>{english}</Text>

      {tip ? (
        <View style={styles.tipBox}>
          <Text style={styles.tipTitle}>💡 Tip</Text>
          <Text style={styles.tipText}>{tip}</Text>
        </View>
      ) : null}

      {onTrySpeaking ? (
        <Pressable style={styles.ctaButton} onPress={onTrySpeaking}>
          <Text style={styles.ctaText}>🎙 Try speaking</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(232, 213, 255, 0.95)",
    shadowColor: "#7E22CE",
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 3,
    gap: 8,
  },
  chinese: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: "700",
    color: "#3B0764",
    textAlign: "center",
  },
  pinyin: {
    fontSize: 15,
    lineHeight: 20,
    textAlign: "center",
    color: "#7E22CE",
  },
  english: {
    fontSize: 14,
    lineHeight: 20,
    color: "#6B7280",
    textAlign: "center",
  },
  tipBox: {
    marginTop: 4,
    backgroundColor: "#FAF5FF",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#E9D5FF",
  },
  tipTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6B21A8",
    marginBottom: 4,
  },
  tipText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#6D28D9",
  },
  ctaButton: {
    marginTop: 4,
    backgroundColor: "#6D28D9",
    borderRadius: 999,
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  ctaText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
});

export default StructuredLearningCard;
