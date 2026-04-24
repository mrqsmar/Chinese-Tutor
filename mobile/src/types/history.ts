export type HistoryEntry = {
  id: string;
  timestamp: number;
  transcript: string;
  chinese: string;
  pinyin: string;
  english: string;
  notes: string[];
  audioUrl?: string | null;
};

export type SavedEntry = HistoryEntry & {
  tag: string;
  savedAt: number;
};
