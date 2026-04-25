import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { FONT_FAMILIES, TOKENS } from "../styles/tokens";

type Props = {
  fontsLoaded: boolean;
  onShowText: () => void;
};

const AudioErrorCard = ({ fontsLoaded, onShowText }: Props) => {
  const frauncesMedItalic = fontsLoaded
    ? { fontFamily: FONT_FAMILIES.frauncesMediumItalic }
    : {};

  return (
    <View style={styles.wrap}>
      <View style={styles.textBlock}>
        <Text style={styles.eyebrow}>— AUDIO UNAVAILABLE</Text>
        <Text style={[styles.headline, frauncesMedItalic]}>
          We have your translation.
        </Text>
        <Text style={styles.body}>
          The audio couldn't be generated, but your translation is ready to read.
        </Text>
      </View>

      <Pressable style={styles.primaryBtn} onPress={onShowText}>
        <Text style={styles.primaryBtnText}>SHOW TEXT</Text>
      </Pressable>
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
    color: TOKENS.inkFaint,
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
  primaryBtn: {
    backgroundColor: TOKENS.ink,
    borderRadius: TOKENS.buttonRadius,
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
});

export default AudioErrorCard;
