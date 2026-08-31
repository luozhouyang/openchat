import { create } from "zustand";
export const useConnectionStore = create<{ state: string; set: (s: string) => void }>((set) => ({
  state: "idle",
  set: (state) => set({ state }),
}));
