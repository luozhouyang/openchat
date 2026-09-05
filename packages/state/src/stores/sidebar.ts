import { create } from "zustand";

interface Entry {
  unread: number;
  mentions: number;
  preview: string | null;
  lastMessageAt: number | null;
  lastReadSeq: number;
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
  /** Cross-device read sync: channel.read from another of the user's devices. */
  readSync: (channelId: string, lastReadSeq: number) => void;
}>((set) => ({
  entries: {},
  bump(channelId) {
    set((s) => {
      const e = s.entries[channelId] ?? {
        unread: 0,
        mentions: 0,
        preview: null,
        lastMessageAt: null,
        lastReadSeq: 0,
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
          lastReadSeq: s.entries[ev.channelId]?.lastReadSeq ?? 0,
        },
      },
    }));
  },
  loadAll(rows) {
    set((s) => ({
      entries: Object.fromEntries(
        rows.map((r) => [
          r.channelId,
          {
            unread: r.unread,
            mentions: r.mentions,
            preview: r.preview,
            lastMessageAt: r.lastMessageAt,
            lastReadSeq: s.entries[r.channelId]?.lastReadSeq ?? 0,
          },
        ]),
      ),
    }));
  },
  markRead(channelId, lastReadSeq) {
    set((s) => {
      const e = s.entries[channelId];
      if (!e) {
        return s;
      }
      const seq = Math.max(lastReadSeq ?? 0, e.lastReadSeq);
      return {
        entries: { ...s.entries, [channelId]: { ...e, unread: 0, mentions: 0, lastReadSeq: seq } },
      };
    });
  },
  readSync(channelId, lastReadSeq) {
    set((s) => {
      const e = s.entries[channelId];
      if (e && lastReadSeq < e.lastReadSeq) {
        return s;
      } // stale echo from a lagging device
      const base = e ?? {
        unread: 0,
        mentions: 0,
        preview: null,
        lastMessageAt: null,
        lastReadSeq: 0,
      };
      return {
        entries: { ...s.entries, [channelId]: { ...base, unread: 0, mentions: 0, lastReadSeq } },
      };
    });
  },
}));
