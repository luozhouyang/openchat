import { create } from "zustand";

export const useTypingStore = create<{
  active: Record<string, Record<string, number>>;
  mark: (channelId: string, userId: string, expiresAt: number) => void;
  list: (channelId: string) => string[];
}>((set, get) => ({
  active: {},
  mark(channelId, userId, expiresAt) {
    set((s) => ({
      active: { ...s.active, [channelId]: { ...s.active[channelId], [userId]: expiresAt } },
    }));
  },
  list(channelId) {
    const now = Date.now();
    return Object.entries(get().active[channelId] ?? {})
      .filter(([, exp]) => exp > now)
      .map(([userId]) => userId);
  },
}));
