import { Animated, StyleSheet, Text, View } from "react-native";
import { useEffect, useMemo, useRef } from "react";

type StructuredLearningCardProps = {
  chinese: string;
  pinyin?: string;
  english: string;
  tip?: string;
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
  const taggedTip = normalized.find((line) => /^(tip|example|note)\s*:/i.test(line));

  const chineseFromTag = taggedChinese?.replace(/^chinese\s*:/i, "").trim();
  const pinyinFromTag = taggedPinyin?.replace(/^pinyin\s*:/i, "").trim();
  const englishFromTag = taggedEnglish
    ?.replace(/^(english|meaning|translation)\s*:/i, "")
    .trim();
  const tipFromTag = taggedTip?.replace(/^(tip|example|note)\s*:/i, "").trim();

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
      <Text style={styles.sectionLabel}>Chinese</Text>
      <Text style={styles.chinese}>{chinese}</Text>
      {pinyin ? (
        <View style={styles.pinyinChip}>
          <Text style={styles.pinyin}>{pinyin}</Text>
        </View>
      ) : null}
      <View style={styles.meaningBlock}>
        <Text style={styles.meaningLabel}>Meaning</Text>
        <Text style={styles.english}>{english}</Text>
      </View>

      {tip ? (
        <View style={styles.tipBox}>
          <Text style={styles.tipTitle}>💡 Example</Text>
          <Text style={styles.tipText}>{tip}</Text>
        </View>
      ) : null}

    </Animated.View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderWidth: 1,
    borderColor: "rgba(228, 209, 183, 0.95)",
    shadowColor: "#8B5A2B",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 3,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "700",
    color: "#A16207",
    textAlign: "center",
  },
  chinese: {
    fontSize: 38,
    lineHeight: 44,
    fontWeight: "800",
    color: "#3B0764",
    textAlign: "center",
    marginTop: -2,
  },
  pinyinChip: {
    alignSelf: "center",
    borderRadius: 999,
    backgroundColor: "#F7EDFF",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#E9D5FF",
  },
  pinyin: {
    fontSize: 15,
    lineHeight: 20,
    textAlign: "center",
    color: "#6B21A8",
    fontWeight: "500",
  },
  meaningBlock: {
    borderTopWidth: 1,
    borderTopColor: "#F1E4CF",
    paddingTop: 10,
    alignItems: "center",
    gap: 4,
  },
  meaningLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: "#A8A29E",
    fontWeight: "700",
  },
  english: {
    fontSize: 14,
    lineHeight: 21,
    color: "#6B7280",
    textAlign: "center",
  },
  tipBox: {
    marginTop: 2,
    backgroundColor: "#FFF7ED",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#FED7AA",
  },
  tipTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#9A3412",
    marginBottom: 4,
  },
  tipText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#7C2D12",
  },
});

export default StructuredLearningCard;
