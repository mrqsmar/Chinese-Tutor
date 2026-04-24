import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { useHistoryStore, useSavedStore } from "../store/historyStore";
import { TOKENS } from "../styles/tokens";
import type { HistoryEntry } from "../types/history";
import { playSoundUrl } from "../utils/audio";
import EntryRow from "./EntryRow";

type DayGroup = { label: string; entries: HistoryEntry[] };

const groupByDay = (entries: HistoryEntry[]): DayGroup[] => {
  const map = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const key = new Date(entry.timestamp).toDateString();
    map.set(key, [...(map.get(key) ?? []), entry]);
  }

  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  return Array.from(map.entries()).map(([key, dayEntries]) => {
    const d = new Date(dayEntries[0].timestamp);
    const month = d.toLocaleString("en-US", { month: "long" }).toUpperCase();
    const day = d.getDate();
    const n = dayEntries.length;
    const word = n === 1 ? "PHRASE" : "PHRASES";
    const prefix = key === today ? "TODAY" : key === yesterday ? "YESTERDAY" : null;
    const label = prefix
      ? `${prefix} · ${month} ${day} · ${n} ${word}`
      : `${month} ${day} · ${n} ${word}`;
    return { label, entries: dayEntries };
  });
};

type Props = { fontsLoaded: boolean };

const HistoryScreen = ({ fontsLoaded }: Props) => {
  const entries = useHistoryStore((s) => s.entries);
  const { save, unsave, isSaved } = useSavedStore();

  if (entries.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyLabel}>NO HISTORY YET</Text>
        <Text style={styles.emptyHint}>Hold the mic button and speak to get started.</Text>
      </View>
    );
  }

  const groups = groupByDay(entries);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {groups.map((group) => (
        <View key={group.label}>
          {/* Day eyebrow */}
          <Text style={styles.dayEyebrow}>{group.label}</Text>

          {group.entries.map((entry, i) => (
            <View key={entry.id}>
              <EntryRow
                entry={entry}
                showTime
                fontsLoaded={fontsLoaded}
                isSaved={isSaved(entry.id)}
                onPlay={() => {
                  if (entry.audioUrl) void playSoundUrl(entry.audioUrl);
                }}
                onToggleSave={() => {
                  isSaved(entry.id) ? unsave(entry.id) : save(entry);
                }}
              />
              {i < group.entries.length - 1 ? <View style={styles.rule} /> : null}
            </View>
          ))}

          {/* Thicker rule between day groups */}
          <View style={styles.dayRule} />
        </View>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: 40,
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 36,
  },
  emptyLabel: {
    fontFamily: Platform.select({ ios: "Courier New", android: "monospace", default: "monospace" }),
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: TOKENS.inkFaint,
    marginBottom: 10,
  },
  emptyHint: {
    fontSize: 14,
    color: TOKENS.inkFaint,
    textAlign: "center",
    lineHeight: 20,
  },
  dayEyebrow: {
    fontFamily: Platform.select({ ios: "Courier New", android: "monospace", default: "monospace" }),
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: TOKENS.inkFaint,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 10,
  },
  rule: {
    height: 1,
    backgroundColor: TOKENS.rule,
    marginHorizontal: 20,
  },
  dayRule: {
    height: 1,
    backgroundColor: TOKENS.ruleStrong,
    marginHorizontal: 0,
    marginTop: 4,
  },
});

export default HistoryScreen;
