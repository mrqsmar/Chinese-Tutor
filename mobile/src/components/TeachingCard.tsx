import { StyleSheet, Text, View } from "react-native";

import type { Teaching } from "../types/chat";

const TeachingCard = ({ teaching }: { teaching: Teaching }) => {
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Teaching Notes</Text>
      <Text style={styles.label}>Translation</Text>
      <Text style={styles.body}>{teaching.translation}</Text>
      <Text style={styles.label}>Pinyin</Text>
      <Text style={styles.body}>{teaching.pinyin}</Text>
      <Text style={styles.label}>Key Points</Text>
      {teaching.key_points.map((point) => (
        <View key={point.phrase} style={styles.keyPoint}>
          <Text style={styles.body}>• {point.phrase}</Text>
          <Text style={styles.subtle}>{point.pinyin}</Text>
          <Text style={styles.subtle}>{point.meaning}</Text>
        </View>
      ))}
      <Text style={styles.label}>Alternatives</Text>
      {teaching.alternatives.map((alt) => (
        <Text key={alt} style={styles.body}>
          • {alt}
        </Text>
      ))}
      <Text style={styles.label}>Follow-up</Text>
      <Text style={styles.body}>{teaching.follow_up}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#F5F7FF",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  heading: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 6,
    color: "#2F2F2F",
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 6,
    color: "#4B4B4B",
  },
  body: {
    fontSize: 13,
    color: "#2F2F2F",
  },
  subtle: {
    fontSize: 12,
    color: "#6B6B6B",
    marginLeft: 12,
  },
  keyPoint: {
    marginTop: 4,
  },
});

export default TeachingCard;
