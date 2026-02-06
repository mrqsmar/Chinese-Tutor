import { useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { getAppPassword } from "../config/appLock";

type LockScreenProps = {
  onUnlock: () => Promise<void> | void;
  isSubmitting?: boolean;
};

const LockScreen = ({ onUnlock, isSubmitting = false }: LockScreenProps) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = async () => {
    const correctPassword = getAppPassword();
    if (!correctPassword) {
      setError("App password is not configured.");
      return;
    }
    if (password.trim() !== correctPassword) {
      setError("Incorrect password. Please try again.");
      return;
    }
    setError(null);
    await onUnlock();
    setPassword("");
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>App Lock</Text>
        <Text style={styles.subtitle}>
          Enter the tester password to continue.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          editable={!isSubmitting}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <TouchableOpacity
          style={[styles.button, isSubmitting && styles.buttonDisabled]}
          onPress={handleUnlock}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>Unlock</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F172A",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0F172A",
  },
  subtitle: {
    marginTop: 10,
    fontSize: 14,
    color: "#475569",
  },
  input: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: "#F8FAFC",
  },
  errorText: {
    marginTop: 12,
    color: "#B91C1C",
    fontSize: 12,
  },
  button: {
    marginTop: 20,
    backgroundColor: "#2563EB",
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: "center",
  },
  buttonDisabled: {
    backgroundColor: "#93C5FD",
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});

export default LockScreen;
