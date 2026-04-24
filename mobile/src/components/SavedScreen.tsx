import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { useSavedStore } from "../store/historyStore";
import { TOKENS } from "../styles/tokens";
import type { SavedEntry } from "../types/history";
import { playSoundUrl } from "../utils/audio";
import EntryRow from "./EntryRow";

type TagGroup = { tag: string; entries: SavedEntry[] };

const groupByTag = (entries: SavedEntry[]): TagGroup[] => {
  const map = new Map<string, SavedEntry[]>();
  for (const entry of entries) {
    map.set(entry.tag, [...(map.get(entry.tag) ?? []), entry]);
  }
  return Array.from(map.entries()).map(([tag, tagEntries]) => ({ tag, entries: tagEntries }));
};

type Props = { fontsLoaded: boolean };

const SavedScreen = ({ fontsLoaded }: Props) => {
  const { entries, unsave } = useSavedStore();

  if (entries.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyLabel}>NOTHING SAVED YET</Text>
        <Text style={styles.emptyHint}>Tap ✦ on any phrase in History to save it here.</Text>
      </View>
    );
  }

  const groups = groupByTag(entries);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {groups.map((group) => (
        <View key={group.tag}>
          {/* Tag eyebrow  — DINING */}
          <Text style={styles.tagEyebrow}>— {group.tag}</Text>

          {group.entries.map((entry, i) => (
            <View key={entry.id}>
              <EntryRow
                entry={entry}
                showGloss
                showTime={false}
                fontsLoaded={fontsLoaded}
                isSaved
                onPlay={() => {
                  if (entry.audioUrl) void playSoundUrl(entry.audioUrl);
                }}
                onToggleSave={() => unsave(entry.id)}
              />
              {i < group.entries.length - 1 ? <View style={styles.rule} /> : null}
            </View>
          ))}

          <View style={styles.tagRule} />
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
  tagEyebrow: {
    fontFamily: Platform.select({ ios: "Courier New", android: "monospace", default: "monospace" }),
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: TOKENS.accent,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 10,
  },
  rule: {
    height: 1,
    backgroundColor: TOKENS.rule,
    marginHorizontal: 20,
  },
  tagRule: {
    height: 1,
    backgroundColor: TOKENS.ruleStrong,
    marginTop: 4,
  },
});

export default SavedScreen;
