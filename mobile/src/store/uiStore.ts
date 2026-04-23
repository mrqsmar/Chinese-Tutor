import { create } from "zustand";

export type ActiveTab = "SPEAK" | "HISTORY" | "SAVED";

type UIState = {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
};

export const useUIStore = create<UIState>((set) => ({
  activeTab: "SPEAK",
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
