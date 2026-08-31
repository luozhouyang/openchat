import { create } from "zustand";
import type { RealtimeState } from "realtime";

export const useConnectionStore = create<{
  state: RealtimeState;
  set: (s: RealtimeState) => void;
}>((set) => ({
  state: "idle",
  set: (state) => set({ state }),
}));
