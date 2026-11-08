import { create } from "zustand";
import type { Message } from "protocol";

export type StoreMessage = Omit<Message, "attachments"> & {
  attachments?: unknown[] | null;
  reactions?: Record<string, string[]>;
  isPinned?: boolean;
};

interface ChannelState {
  /** Server-confirmed messages keyed by their channel seq. */
  bySeq: Map<number, StoreMessage>;
  /** Optimistic sends keyed by clientToken. Never occupy the server seq space. */
  pending: Map<string, StoreMessage>;
  /** Out-of-order arrivals parked until their hole is filled. */
  buffered: Map<number, StoreMessage>;
  maxSeq: number;
}

interface MessageState {
  channels: Record<string, ChannelState>;
  threads: Record<string, StoreMessage[]>;
  reset: (channelId: string) => void;
  ingest: (channelId: string, message: StoreMessage) => void;
  appendPending: (channelId: string, clientToken: string, message: StoreMessage) => void;
  applySync: (channelId: string, messages: StoreMessage[]) => void;
  list: (channelId: string) => StoreMessage[];
  maxSeq: (channelId: string) => number;
  ack: (channelId: string, clientToken: string, real: { id: string; seq: number }) => void;
  fail: (channelId: string, clientToken: string) => void;
  edit: (channelId: string, messageId: string, content: string, editedAt?: number) => void;
  remove: (channelId: string, messageId: string) => void;
  setReactions: (
    channelId: string,
    messageSeq: number,
    reactions: Record<string, string[]>,
  ) => void;
  setPinned: (channelId: string, messageId: string, pinned: boolean) => void;
  ingestThread: (channelId: string, message: StoreMessage) => void;
  threadList: (channelId: string, parentId: string) => StoreMessage[];
}

function ensure(state: MessageState, channelId: string): ChannelState {
  return (state.channels[channelId] ??= {
    bySeq: new Map(),
    pending: new Map(),
    buffered: new Map(),
    maxSeq: 0,
  });
}

function drain(ch: ChannelState) {
  for (;;) {
    const next = ch.buffered.get(ch.maxSeq + 1);
    if (!next) {
      break;
    }
    ch.buffered.delete(next.seq);
    ch.bySeq.set(next.seq, next);
    ch.maxSeq = next.seq;
  }
}

function insertConfirmed(ch: ChannelState, message: StoreMessage) {
  if (message.seq <= ch.maxSeq) {
    // Echo of something we already hold at this seq — ignore.
    if (!ch.bySeq.has(message.seq)) {
      ch.bySeq.set(message.seq, message);
    }
  } else if (message.seq === ch.maxSeq + 1) {
    ch.bySeq.set(message.seq, message);
    ch.maxSeq = message.seq;
    drain(ch);
  } else {
    ch.buffered.set(message.seq, message);
  }
}

export const useMessageStore = create<MessageState>((set, get) => ({
  channels: {},
  threads: {},
  reset(channelId) {
    set((s) => {
      s.channels[channelId] = {
        bySeq: new Map(),
        pending: new Map(),
        buffered: new Map(),
        maxSeq: 0,
      };
      return { channels: { ...s.channels } };
    });
  },
  ingest(channelId, message) {
    set((s) => {
      const ch = ensure(s, channelId);
      if (message.seq <= ch.maxSeq || ch.bySeq.has(message.seq)) {
        return s;
      }
      insertConfirmed(ch, message);
      return { channels: { ...s.channels } };
    });
  },
  appendPending(channelId, clientToken, message) {
    set((s) => {
      const ch = ensure(s, channelId);
      // seq stays 0: pending messages render after confirmed ones and never
      // advance maxSeq (so mark_read and gap detection see server truth only).
      ch.pending.set(clientToken, { ...message, seq: 0 });
      return { channels: { ...s.channels } };
    });
  },
  applySync(channelId, messages) {
    set((s) => {
      const ch = ensure(s, channelId);
      for (const m of messages) {
        if (m.seq > ch.maxSeq && !ch.bySeq.has(m.seq)) {
          ch.bySeq.set(m.seq, m);
          if (m.seq > ch.maxSeq) {
            ch.maxSeq = m.seq;
          }
        }
      }
      drain(ch);
      return { channels: { ...s.channels } };
    });
  },
  list(channelId) {
    // Derives a fresh array: components should not subscribe with this
    // selector (unstable snapshot); read it on demand or select maxSeq.
    const ch = get().channels[channelId];
    if (!ch) {
      return [];
    }
    return [...ch.bySeq.values()].sort((a, b) => a.seq - b.seq).concat([...ch.pending.values()]);
  },
  maxSeq(channelId) {
    return get().channels[channelId]?.maxSeq ?? 0;
  },
  ack(channelId, clientToken, real) {
    set((s) => {
      const ch = ensure(s, channelId);
      const old = ch.pending.get(clientToken);
      if (!old) {
        return s;
      }
      ch.pending.delete(clientToken);
      insertConfirmed(ch, { ...old, id: real.id, seq: real.seq });
      return { channels: { ...s.channels } };
    });
  },
  fail(channelId, clientToken) {
    set((s) => {
      const ch = ensure(s, channelId);
      if (ch.pending.delete(clientToken)) {
        return { channels: { ...s.channels } };
      }
      return s;
    });
  },
  /**
   * Clone-on-write updates (review #12): editing/removing/reactions must yield
   * NEW message references or `useShallow(s.list(channelId))` subscribers see
   * identical element refs and skip the re-render.
   */
  edit(channelId, messageId, content, editedAt) {
    const at = editedAt ?? Date.now();
    set((s) => {
      const ch = s.channels[channelId];
      let channels = s.channels;
      let channelChanged = false;
      if (ch) {
        let nextBySeq: Map<number, StoreMessage> | null = null;
        for (const [seq, m] of ch.bySeq) {
          if (m.id === messageId) {
            nextBySeq ??= new Map(ch.bySeq);
            nextBySeq.set(seq, { ...m, content, editedAt: at });
            channelChanged = true;
          }
        }
        if (nextBySeq) {
          channels = { ...channels, [channelId]: { ...ch, bySeq: nextBySeq } };
        }
      }
      let threadsChanged = false;
      const threads = { ...s.threads };
      const prefix = `${channelId}:`;
      for (const [key, arr] of Object.entries(threads)) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        const next = arr.map((m) => (m.id === messageId ? { ...m, content, editedAt: at } : m));
        if (next.some((m, i) => m !== arr[i])) {
          threads[key] = next;
          threadsChanged = true;
        }
      }
      if (!channelChanged && !threadsChanged) {
        return s;
      }
      return { channels, threads };
    });
  },
  remove(channelId, messageId) {
    const at = Date.now();
    set((s) => {
      const ch = s.channels[channelId];
      let channels = s.channels;
      let channelChanged = false;
      if (ch) {
        let nextBySeq: Map<number, StoreMessage> | null = null;
        for (const [seq, m] of ch.bySeq) {
          if (m.id === messageId) {
            nextBySeq ??= new Map(ch.bySeq);
            nextBySeq.set(seq, { ...m, deletedAt: at });
            channelChanged = true;
          }
        }
        if (nextBySeq) {
          channels = { ...channels, [channelId]: { ...ch, bySeq: nextBySeq } };
        }
      }
      let threadsChanged = false;
      const threads = { ...s.threads };
      const prefix = `${channelId}:`;
      for (const [key, arr] of Object.entries(threads)) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        const next = arr.map((m) => (m.id === messageId ? { ...m, deletedAt: at } : m));
        if (next.some((m, i) => m !== arr[i])) {
          threads[key] = next;
          threadsChanged = true;
        }
      }
      if (!channelChanged && !threadsChanged) {
        return s;
      }
      return { channels, threads };
    });
  },
  setReactions(channelId, messageSeq, reactions) {
    set((s) => {
      const ch = s.channels[channelId];
      let channels = s.channels;
      let channelChanged = false;
      if (ch && ch.bySeq.has(messageSeq)) {
        const m = ch.bySeq.get(messageSeq)!;
        channels = {
          ...channels,
          [channelId]: {
            ...ch,
            bySeq: new Map(ch.bySeq).set(messageSeq, { ...m, reactions }),
          },
        };
        channelChanged = true;
      }
      let threadsChanged = false;
      const threads = { ...s.threads };
      const prefix = `${channelId}:`;
      for (const [key, arr] of Object.entries(threads)) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        const idx = arr.findIndex((x) => x.seq === messageSeq);
        if (idx === -1) {
          continue;
        }
        const next = [...arr];
        next[idx] = { ...next[idx], reactions };
        threads[key] = next;
        threadsChanged = true;
      }
      if (!channelChanged && !threadsChanged) {
        return s;
      }
      return { channels, threads };
    });
  },
  setPinned(channelId, messageId, pinned) {
    set((s) => {
      const ch = s.channels[channelId];
      let channels = s.channels;
      let channelChanged = false;
      if (ch) {
        let nextBySeq: Map<number, StoreMessage> | null = null;
        for (const [seq, m] of ch.bySeq) {
          if (m.id === messageId) {
            nextBySeq ??= new Map(ch.bySeq);
            nextBySeq.set(seq, { ...m, isPinned: pinned });
            channelChanged = true;
          }
        }
        if (nextBySeq) {
          channels = { ...channels, [channelId]: { ...ch, bySeq: nextBySeq } };
        }
      }
      let threadsChanged = false;
      const threads = { ...s.threads };
      const prefix = `${channelId}:`;
      for (const [key, arr] of Object.entries(threads)) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        const next = arr.map((m) => (m.id === messageId ? { ...m, isPinned: pinned } : m));
        if (next.some((m, i) => m !== arr[i])) {
          threads[key] = next;
          threadsChanged = true;
        }
      }
      if (!channelChanged && !threadsChanged) {
        return s;
      }
      return { channels, threads };
    });
  },
  ingestThread(channelId, message) {
    set((s) => {
      if (!message.parentId) {
        return s;
      }
      const key = `${channelId}:${message.parentId}`;
      const arr = s.threads[key] ?? [];
      if (arr.some((m) => m.id === message.id)) {
        return s;
      }
      const next = [...arr, { ...message }].sort((a, b) => a.seq - b.seq);
      return { threads: { ...s.threads, [key]: next } };
    });
  },
  threadList(channelId, parentId) {
    return get().threads[`${channelId}:${parentId}`] ?? [];
  },
}));
