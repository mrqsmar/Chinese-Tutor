import React from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

type AuthScreenProps = {
  onSubmit: (username: string, password: string) => void;
  isSubmitting: boolean;
  error?: string | null;
};

export default function AuthScreen({
  onSubmit,
  isSubmitting,
  error,
}: AuthScreenProps) {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Sign in</Text>
        <Text style={styles.subtitle}>
          Use the credentials configured on the API server.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Email or username"
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          editable={!isSubmitting}
          onChangeText={setUsername}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          value={password}
          editable={!isSubmitting}
          onChangeText={setPassword}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity
          style={[styles.button, isSubmitting && styles.buttonDisabled]}
          disabled={isSubmitting}
          onPress={() => onSubmit(username.trim(), password)}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>Continue</Text>
          )}
        </TouchableOpacity>
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
  subtitle: {
    marginTop: 8,
    fontSize: 13,
    color: "#6B7280",
  },
  input: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
    fontSize: 14,
  },
  button: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "#2F6FED",
    alignItems: "center",
  },
  buttonDisabled: {
    backgroundColor: "#9BB6F5",
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 14,
  },
  error: {
    marginTop: 8,
    fontSize: 12,
    color: "#B91C1C",
  },
});
