import { create } from "zustand";
interface Entry {
  unread: number;
  mentions: number;
  preview: string | null;
  lastMessageAt: number | null;
}
export const useSidebarStore = create<{
  entries: Record<string, Entry>;
  bump: (channelId: string) => void;
  apply: (ev: {
    channelId: string;
    unread: number;
    mentions: number;
    lastMessage: { preview: string; at: number };
  }) => void;
  loadAll: (
    rows: Array<{
      channelId: string;
      unread: number;
      mentions: number;
      preview: string | null;
      lastMessageAt: number | null;
    }>,
  ) => void;
  markRead: (channelId: string, lastReadSeq?: number) => void;
}>((set) => ({
  entries: {},
  bump(channelId) {
    set((s) => {
      const e = s.entries[channelId] ?? {
        unread: 0,
        mentions: 0,
        preview: null,
        lastMessageAt: null,
      };
      return { entries: { ...s.entries, [channelId]: { ...e, unread: e.unread + 1 } } };
    });
  },
  apply(ev) {
    set((s) => ({
      entries: {
        ...s.entries,
        [ev.channelId]: {
          unread: ev.unread,
          mentions: ev.mentions,
          preview: ev.lastMessage.preview,
          lastMessageAt: ev.lastMessage.at,
        },
      },
    }));
  },
  loadAll(rows) {
    set(() => ({
      entries: Object.fromEntries(
        rows.map((r) => [
          r.channelId,
          {
            unread: r.unread,
            mentions: r.mentions,
            preview: r.preview,
            lastMessageAt: r.lastMessageAt,
          },
        ]),
      ),
    }));
  },
  markRead(channelId) {
    set((s) => {
      const e = s.entries[channelId];
      if (!e) return s;
      return { entries: { ...s.entries, [channelId]: { ...e, unread: 0, mentions: 0 } } };
    });
  },
}));
