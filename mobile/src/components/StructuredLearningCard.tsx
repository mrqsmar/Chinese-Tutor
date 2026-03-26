import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, useMemo, useRef } from "react";

type CardData = {
  chinese: string;
  pinyin?: string;
  english: string;
  tip?: string;
};

type StructuredLearningCardProps = CardData & {
  mode?: "english" | "chinese";
  onSuggestionPress?: (text: string) => void;
};

const HAN_REGEX = /[\u3400-\u9FFF]/;

const sanitize = (value?: string) => value?.trim() ?? "";

export const parseLearningCard = (text: string): CardData => {
  const normalized = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const taggedChinese = normalized.find((line) => /^chinese\s*:/i.test(line));
  const taggedPinyin = normalized.find((line) => /^(pinyin|pronunciation)\s*:/i.test(line));
  const taggedEnglish = normalized.find(
    (line) => /^(english|meaning|translation)\s*:/i.test(line)
  );
  const taggedTip = normalized.find((line) => /^(tip|example|notes?)\s*:/i.test(line));

  const chineseFromTag = taggedChinese?.replace(/^chinese\s*:/i, "").trim();
  const pinyinFromTag = taggedPinyin?.replace(/^(pinyin|pronunciation)\s*:/i, "").trim();
  const englishFromTag = taggedEnglish
    ?.replace(/^(english|meaning|translation)\s*:/i, "")
    .trim();
  const tipFromTag = taggedTip?.replace(/^(tip|example|notes?)\s*:/i, "").trim();

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

export const parseMultipleCards = (text: string): CardData[] => {
  const blocks = text
    .split(/\n---\n|^---$/m)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocks.length === 0) return [parseLearningCard(text)];
  return blocks.map((block) => parseLearningCard(block));
};

const SUGGESTIONS_EN = ["Give me an example sentence", "How do I practice this?", "Teach me the next word"];
const SUGGESTIONS_ZH = ["给我一个例句", "怎么练习这个？", "继续下一个词"];

const SuggestionChips = ({
  mode,
  tip,
  onSuggestionPress,
}: {
  mode?: "english" | "chinese";
  tip?: string;
  onSuggestionPress: (text: string) => void;
}) => {
  const isZh = mode === "chinese";
  const staticChips = isZh ? SUGGESTIONS_ZH : SUGGESTIONS_EN;
  const chips = tip ? [tip, ...staticChips.slice(0, 2)] : staticChips;

  return (
    <View style={styles.chipsRow}>
      {chips.map((chip) => (
        <Pressable
          key={chip}
          style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
          onPress={() => onSuggestionPress(chip)}
        >
          <Text style={styles.chipText}>{chip}</Text>
        </Pressable>
      ))}
    </View>
  );
};

const SingleCard = ({
  chinese,
  pinyin,
  english,
  tip,
  mode,
  delay = 0,
}: CardData & { mode?: "english" | "chinese"; delay?: number }) => {
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(entrance, {
        toValue: 1,
        duration: 360,
        useNativeDriver: true,
      }).start();
    }, delay);
    return () => clearTimeout(timer);
  }, [entrance, delay]);

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

  const isZh = mode === "chinese";
  const primaryLabel = isZh ? "ENGLISH" : "CHINESE";
  const primaryText = chinese; // In ZH mode system prompt puts English word here
  const pronunciationText = pinyin;
  const meaningLabel = isZh ? "中文" : "MEANING";
  const meaningText = english;

  return (
    <Animated.View style={[styles.card, cardStyle]}>
      <Text style={styles.sectionLabel}>{primaryLabel}</Text>
      <Text style={[styles.chinese, isZh && styles.englishWord]}>{primaryText}</Text>
      {pronunciationText ? (
        <View style={styles.pinyinChip}>
          <Text style={styles.pinyin}>{pronunciationText}</Text>
        </View>
      ) : null}
      <View style={styles.meaningBlock}>
        <Text style={styles.meaningLabel}>{meaningLabel}</Text>
        <Text style={styles.english}>{meaningText}</Text>
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

const StructuredLearningCard = ({
  chinese,
  pinyin,
  english,
  tip,
  mode,
  onSuggestionPress,
}: StructuredLearningCardProps) => (
  <View style={styles.wrapper}>
    <SingleCard
      chinese={chinese}
      pinyin={pinyin}
      english={english}
      tip={tip}
      mode={mode}
    />
    {onSuggestionPress ? (
      <SuggestionChips mode={mode} tip={undefined} onSuggestionPress={onSuggestionPress} />
    ) : null}
  </View>
);

export const MultiCardGroup = ({
  cards,
  mode,
  onSuggestionPress,
}: {
  cards: CardData[];
  mode?: "english" | "chinese";
  onSuggestionPress?: (text: string) => void;
}) => (
  <View style={styles.wrapper}>
    {cards.map((card, i) => (
      <SingleCard
        key={`${card.chinese}-${i}`}
        chinese={card.chinese}
        pinyin={card.pinyin}
        english={card.english}
        tip={card.tip}
        mode={mode}
        delay={i * 120}
      />
    ))}
    {onSuggestionPress ? (
      <SuggestionChips mode={mode} tip={undefined} onSuggestionPress={onSuggestionPress} />
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  wrapper: {
    gap: 8,
  },
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
  englishWord: {
    fontSize: 30,
    lineHeight: 36,
    color: "#1E3A5F",
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
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 2,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    borderWidth: 1.5,
    borderColor: "rgba(161, 98, 7, 0.3)",
  },
  chipPressed: {
    backgroundColor: "rgba(161, 98, 7, 0.1)",
    borderColor: "rgba(161, 98, 7, 0.6)",
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#92400E",
  },
});

export default StructuredLearningCard;
