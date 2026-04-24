import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { HistoryEntry, SavedEntry } from "../types/history";

type HistoryState = {
  entries: HistoryEntry[];
  addEntry: (entry: HistoryEntry) => void;
  clear: () => void;
};

type SavedState = {
  entries: SavedEntry[];
  save: (entry: HistoryEntry, tag?: string) => void;
  unsave: (id: string) => void;
  isSaved: (id: string) => boolean;
};

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set) => ({
      entries: [],
      addEntry: (entry) =>
        set((s) => ({ entries: [entry, ...s.entries].slice(0, 500) })),
      clear: () => set({ entries: [] }),
    }),
    {
      name: "voice-history-v1",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

export const useSavedStore = create<SavedState>()(
  persist(
    (set, get) => ({
      entries: [],
      save: (entry, tag = "GENERAL") =>
        set((s) => ({
          entries: s.entries.some((e) => e.id === entry.id)
            ? s.entries
            : [{ ...entry, tag, savedAt: Date.now() }, ...s.entries],
        })),
      unsave: (id) =>
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
      isSaved: (id) => get().entries.some((e) => e.id === id),
    }),
    {
      name: "voice-saved-v1",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
