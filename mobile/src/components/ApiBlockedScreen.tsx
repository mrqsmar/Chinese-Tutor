import { SafeAreaView, StyleSheet, Text, View } from "react-native";

type ApiBlockedScreenProps = {
  reason: string;
};

export default function ApiBlockedScreen({ reason }: ApiBlockedScreenProps) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Missing API URL</Text>
        <Text style={styles.body}>
          This app requires a deployed HTTPS API. Update EXPO_PUBLIC_API_URL
          and reload the app.
        </Text>
        <Text style={styles.reason}>{reason}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#F8FAFC",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 420,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
  },
  body: {
    marginTop: 12,
    fontSize: 14,
    color: "#374151",
  },
  reason: {
    marginTop: 12,
    fontSize: 12,
    color: "#B91C1C",
  },
});
