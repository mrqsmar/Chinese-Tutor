import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { FONT_FAMILIES, TOKENS } from "../styles/tokens";

type Props = {
  fontsLoaded: boolean;
  onTryAgain: () => void;
  onTypeInsteadSubmit: (text: string) => void;
};

const CantHearCard = ({ fontsLoaded, onTryAgain, onTypeInsteadSubmit }: Props) => {
  const [showSheet, setShowSheet] = useState(false);
  const [input, setInput] = useState("");

  const frauncesMedItalic = fontsLoaded
    ? { fontFamily: FONT_FAMILIES.frauncesMediumItalic }
    : {};
  const frauncesRegItalic = fontsLoaded
    ? { fontFamily: FONT_FAMILIES.frauncesRegularItalic }
    : {};

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setShowSheet(false);
    onTypeInsteadSubmit(text);
  };

  return (
    <View style={styles.wrap}>
      {/* ── Text content ─────────────────────────────────── */}
      <View style={styles.textBlock}>
        <Text style={styles.eyebrow}>— COULDN'T HEAR YOU</Text>
        <Text style={[styles.headline, frauncesMedItalic]}>
          Try again, a little louder.
        </Text>
        <Text style={styles.body}>
          Background noise, or your mic drifted. Hold the button and speak
          directly toward your phone.
        </Text>
      </View>

      {/* ── Action buttons ───────────────────────────────── */}
      <View style={styles.buttons}>
        <Pressable style={styles.primaryBtn} onPress={onTryAgain}>
          <Text style={styles.primaryBtnText}>TRY AGAIN</Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={() => setShowSheet(true)}>
          <Text style={styles.secondaryBtnText}>TYPE INSTEAD</Text>
        </Pressable>
      </View>

      {/* ── Type Instead bottom sheet ─────────────────────── */}
      <Modal
        visible={showSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSheet(false)}
      >
        <KeyboardAvoidingView
          style={styles.sheetOuter}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setShowSheet(false)} />
          <View style={styles.sheetPanel}>
            <Text style={styles.sheetEyebrow}>WHAT DID YOU WANT TO SAY?</Text>
            <TextInput
              style={[styles.sheetInput, frauncesRegItalic]}
              value={input}
              onChangeText={setInput}
              placeholder="e.g. How do I order coffee?"
              placeholderTextColor={TOKENS.inkFaint}
              autoFocus
              returnKeyType="send"
              onSubmitEditing={submit}
            />
            <Pressable
              style={[styles.sheetSubmitBtn, !input.trim() && styles.sheetSubmitBtnDisabled]}
              onPress={submit}
              disabled={!input.trim()}
            >
              <Text style={styles.sheetSubmitText}>TRANSLATE →</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const MONO = Platform.select({ ios: "Courier New", android: "monospace", default: "monospace" });

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    paddingHorizontal: 28,
    paddingBottom: 36,
    justifyContent: "space-between",
  },
  textBlock: {
    flex: 1,
    justifyContent: "center",
    paddingBottom: 20,
  },
  eyebrow: {
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: "#7A2D1E",
    marginBottom: 18,
  },
  headline: {
    fontSize: 30,
    lineHeight: 36,
    fontStyle: "italic",
    color: TOKENS.ink,
    marginBottom: 16,
  },
  body: {
    fontSize: 14,
    lineHeight: 22,
    color: TOKENS.inkSoft,
  },
  buttons: {
    gap: 10,
  },
  primaryBtn: {
    backgroundColor: TOKENS.ink,
    borderRadius: 2,
    paddingVertical: 15,
    alignItems: "center",
  },
  primaryBtnText: {
    fontFamily: MONO,
    fontSize: 12,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: "#FFFFFF",
  },
  secondaryBtn: {
    borderRadius: 2,
    borderWidth: 1.5,
    borderColor: TOKENS.ink,
    paddingVertical: 15,
    alignItems: "center",
  },
  secondaryBtnText: {
    fontFamily: MONO,
    fontSize: 12,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: TOKENS.ink,
  },
  // ── Sheet ────────────────────────────────────────────────────
  sheetOuter: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetPanel: {
    backgroundColor: TOKENS.bgCard,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: Platform.OS === "ios" ? 44 : 28,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
  },
  sheetEyebrow: {
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: TOKENS.inkFaint,
    marginBottom: 16,
  },
  sheetInput: {
    fontSize: 20,
    fontStyle: "italic",
    color: TOKENS.ink,
    borderBottomWidth: 1.5,
    borderBottomColor: TOKENS.ruleStrong,
    paddingVertical: 10,
    marginBottom: 20,
  },
  sheetSubmitBtn: {
    backgroundColor: TOKENS.ink,
    borderRadius: 2,
    paddingVertical: 14,
    alignItems: "center",
  },
  sheetSubmitBtnDisabled: {
    opacity: 0.35,
  },
  sheetSubmitText: {
    fontFamily: MONO,
    fontSize: 12,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: "#FFFFFF",
  },
});

export default CantHearCard;
