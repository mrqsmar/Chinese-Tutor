export const TOKENS = {
  bg: "#F5F2EC",
  bgCard: "#FFFDF8",
  ink: "#15110D",
  inkSoft: "#544B40",
  inkFaint: "#8F8578",
  accent: "#1D4D3B",
  accentSoft: "#E3EADD",
  rule: "rgba(21,17,13,0.12)",
  ruleStrong: "rgba(21,17,13,0.22)",
  tones: {
    t1: "#B44637",
    t2: "#3E7A3C",
    t3: "#2E5E8C",
    t4: "#7A2D1E",
    t5: "#8F8578",
  },
} as const;

export const getToneColor = (tone: 1 | 2 | 3 | 4 | 5): string =>
  TOKENS.tones[`t${tone}` as keyof typeof TOKENS.tones];

export const FONT_FAMILIES = {
  frauncesRegular: "Fraunces_400Regular",
  frauncesRegularItalic: "Fraunces_400Regular_Italic",
  frauncesMedium: "Fraunces_500Medium",
  frauncesMediumItalic: "Fraunces_500Medium_Italic",
  notoSerifRegular: "NotoSerifSC_400Regular",
  notoSerifMedium: "NotoSerifSC_500Medium",
  spaceGroteskMedium: "SpaceGrotesk_500Medium",
  spaceGroteskSemiBold: "SpaceGrotesk_600SemiBold",
  spaceGroteskBold: "SpaceGrotesk_700Bold",
} as const;
