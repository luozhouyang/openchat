import { create } from "zustand";

/**
 * Bumped on every `structure.update` server event. Views that render
 * team/channel structure subscribe to `version` and refetch when it moves —
 * no polling on navigation.
 */
export const useStructureStore = create<{
  version: number;
  scope: "channels" | "teams" | null;
  bump: (scope: "channels" | "teams") => void;
}>((set) => ({
  version: 0,
  scope: null,
  bump(scope) {
    set((s) => ({ version: s.version + 1, scope }));
  },
}));
