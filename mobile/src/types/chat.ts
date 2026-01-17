export type KeyPoint = {
  phrase: string;
  pinyin: string;
  meaning: string;
};

export type Teaching = {
  translation: string;
  pinyin: string;
  key_points: KeyPoint[];
  alternatives: string[];
  follow_up: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  teaching?: Teaching;
};
