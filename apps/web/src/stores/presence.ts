import { create } from "zustand";
import type { PresenceStatus } from "protocol";
export const usePresenceStore = create<{
  states: Record<string, PresenceStatus>;
  set: (userId: string, status: PresenceStatus) => void;
  applySnapshot: (states: Record<string, PresenceStatus>) => void;
}>((set) => ({
  states: {},
  set: (userId, status) => set((s) => ({ states: { ...s.states, [userId]: status } })),
  applySnapshot: (states) => set((s) => ({ states: { ...s.states, ...states } })),
}));
