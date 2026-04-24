import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { FONT_FAMILIES, TOKENS, toneColor } from "../styles/tokens";
import type { HistoryEntry } from "../types/history";

type EntryRowProps = {
  entry: HistoryEntry;
  showGloss?: boolean;
  showTime?: boolean;
  fontsLoaded: boolean;
  isSaved: boolean;
  onPlay: () => void;
  onToggleSave: () => void;
};

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const EntryRow = ({
  entry,
  showGloss = false,
  showTime = true,
  fontsLoaded,
  isSaved,
  onPlay,
  onToggleSave,
}: EntryRowProps) => {
  const frauncesItalic = fontsLoaded
    ? { fontFamily: FONT_FAMILIES.frauncesMediumItalic }
    : {};
  const notoSerif = fontsLoaded
    ? { fontFamily: FONT_FAMILIES.notoSerifMedium }
    : {};
  const spaceGrotesk = fontsLoaded
    ? { fontFamily: FONT_FAMILIES.spaceGroteskMedium }
    : {};

  const syllables = entry.pinyin.trim().split(/\s+/);
  const hasAudio = Boolean(entry.audioUrl);

  return (
    <View style={styles.row}>
      {/* ── Left content ────────────────────────────────── */}
      <View style={styles.content}>
        {showTime ? (
          <Text style={styles.time}>{formatTime(entry.timestamp)}</Text>
        ) : null}
        {entry.transcript ? (
          <Text style={[styles.query, frauncesItalic]} numberOfLines={2}>
            "{entry.transcript}"
          </Text>
        ) : null}
        <Text style={[styles.chinese, notoSerif]}>{entry.chinese}</Text>
        <View style={styles.pinyinRow}>
          {syllables.map((s, i) => (
            <Text key={i} style={[styles.pinyinSyllable, spaceGrotesk, { color: toneColor(s) }]}>
              {s}
            </Text>
          ))}
        </View>
        {showGloss && entry.english ? (
          <Text style={[styles.gloss, frauncesItalic]} numberOfLines={2}>
            "{entry.english}"
          </Text>
        ) : null}
      </View>

      {/* ── Right actions ────────────────────────────────── */}
      <View style={styles.actions}>
        <Pressable
          onPress={onPlay}
          style={[styles.actionBtn, !hasAudio && styles.actionBtnDisabled]}
          disabled={!hasAudio}
        >
          <Text style={[styles.actionIcon, !hasAudio && styles.actionIconDisabled]}>▶</Text>
        </Pressable>
        <Pressable onPress={onToggleSave} style={styles.actionBtn}>
          <Text style={[styles.actionIcon, isSaved && styles.actionIconSaved]}>✦</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  content: {
    flex: 1,
    marginRight: 14,
  },
  time: {
    fontFamily: Platform.select({ ios: "Courier New", android: "monospace", default: "monospace" }),
    fontSize: 10,
    letterSpacing: 1.2,
    color: TOKENS.inkFaint,
    marginBottom: 5,
  },
  query: {
    fontSize: 15,
    fontStyle: "italic",
    lineHeight: 20,
    color: TOKENS.inkSoft,
    marginBottom: 6,
  },
  chinese: {
    fontSize: 30,
    lineHeight: 36,
    color: TOKENS.ink,
    marginBottom: 5,
  },
  pinyinRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 3,
  },
  pinyinSyllable: {
    fontSize: 13,
    fontWeight: "500",
  },
  gloss: {
    marginTop: 6,
    fontSize: 14,
    fontStyle: "italic",
    lineHeight: 19,
    color: TOKENS.inkSoft,
  },
  actions: {
    alignItems: "center",
    gap: 14,
    paddingTop: 2,
  },
  actionBtn: {
    padding: 4,
  },
  actionBtnDisabled: {
    opacity: 0.3,
  },
  actionIcon: {
    fontSize: 16,
    color: TOKENS.inkFaint,
  },
  actionIconSaved: {
    color: TOKENS.accent,
  },
  actionIconDisabled: {
    color: TOKENS.inkFaint,
  },
});

export default EntryRow;
