import { create } from "zustand";
import type { Message } from "protocol";

export type StoreMessage = Message & { reactions?: Record<string, string[]> };

interface ChannelState {
  bySeq: Map<number, StoreMessage>;
  pending: Map<number, StoreMessage>;
  maxSeq: number;
}

interface MessageState {
  channels: Record<string, ChannelState>;
  threads: Record<string, StoreMessage[]>;
  reset: (channelId: string) => void;
  ingest: (channelId: string, message: StoreMessage) => void;
  applySync: (channelId: string, messages: StoreMessage[]) => void;
  list: (channelId: string) => StoreMessage[];
  maxSeq: (channelId: string) => number;
  ack: (channelId: string, clientToken: string, real: { id: string; seq: number }) => void;
  fail: (channelId: string, clientToken: string) => void;
  edit: (channelId: string, messageId: string, content: string) => void;
  remove: (channelId: string, messageId: string) => void;
  setReactions: (
    channelId: string,
    messageSeq: number,
    reactions: Record<string, string[]>,
  ) => void;
  ingestThread: (channelId: string, message: StoreMessage) => void;
  threadList: (channelId: string, parentId: string) => StoreMessage[];
}

function ensure(state: MessageState, channelId: string): ChannelState {
  return (state.channels[channelId] ??= { bySeq: new Map(), pending: new Map(), maxSeq: 0 });
}

function drain(ch: ChannelState) {
  for (;;) {
    const next = ch.pending.get(ch.maxSeq + 1);
    if (!next) break;
    ch.pending.delete(next.seq);
    ch.bySeq.set(next.seq, next);
    ch.maxSeq = next.seq;
  }
}

function removeById(ch: ChannelState, id: string): StoreMessage | null {
  for (const [seq, m] of ch.bySeq) {
    if (m.id === id) {
      ch.bySeq.delete(seq);
      ch.maxSeq = 0;
      for (const k of ch.bySeq.keys()) if (k > ch.maxSeq) ch.maxSeq = k;
      return m;
    }
  }
  for (const [seq, m] of ch.pending) {
    if (m.id === id) {
      ch.pending.delete(seq);
      return m;
    }
  }
  return null;
}

export const useMessageStore = create<MessageState>((set, get) => ({
  channels: {},
  threads: {},
  reset(channelId) {
    set((s) => {
      s.channels[channelId] = { bySeq: new Map(), pending: new Map(), maxSeq: 0 };
      return { channels: { ...s.channels } };
    });
  },
  ingest(channelId, message) {
    set((s) => {
      const ch = ensure(s, channelId);
      if (message.seq <= ch.maxSeq || ch.bySeq.has(message.seq)) return s;
      if (message.seq === ch.maxSeq + 1) {
        ch.bySeq.set(message.seq, message);
        ch.maxSeq = message.seq;
        drain(ch);
      } else {
        ch.pending.set(message.seq, message);
      }
      return { channels: { ...s.channels } };
    });
  },
  applySync(channelId, messages) {
    set((s) => {
      const ch = ensure(s, channelId);
      for (const m of messages) {
        if (m.seq > ch.maxSeq && !ch.bySeq.has(m.seq)) {
          ch.bySeq.set(m.seq, m);
          if (m.seq > ch.maxSeq) ch.maxSeq = m.seq;
        }
      }
      drain(ch);
      return { channels: { ...s.channels } };
    });
  },
  list(channelId) {
    const ch = get().channels[channelId];
    if (!ch) return [];
    return [...ch.bySeq.values()].sort((a, b) => a.seq - b.seq);
  },
  maxSeq(channelId) {
    return get().channels[channelId]?.maxSeq ?? 0;
  },
  ack(channelId, clientToken, real) {
    set((s) => {
      const ch = ensure(s, channelId);
      const old = removeById(ch, `pending-${clientToken}`);
      if (!old) return s;
      const message = { ...old, id: real.id, seq: real.seq };
      if (message.seq <= ch.maxSeq) {
        if (ch.bySeq.has(message.seq)) return { channels: { ...s.channels } };
        ch.bySeq.set(message.seq, message);
      } else if (message.seq === ch.maxSeq + 1) {
        ch.bySeq.set(message.seq, message);
        ch.maxSeq = message.seq;
        drain(ch);
      } else {
        ch.pending.set(message.seq, message);
      }
      return { channels: { ...s.channels } };
    });
  },
  fail(channelId, clientToken) {
    set((s) => {
      const ch = ensure(s, channelId);
      if (removeById(ch, `pending-${clientToken}`)) {
        return { channels: { ...s.channels } };
      }
      return s;
    });
  },
  edit(channelId, messageId, content) {
    set((s) => {
      const ch = ensure(s, channelId);
      for (const m of ch.bySeq.values()) {
        if (m.id === messageId) {
          m.content = content;
          m.editedAt = Date.now();
        }
      }
      const prefix = `${channelId}:`;
      const threads = { ...s.threads };
      for (const [key, arr] of Object.entries(threads)) {
        if (!key.startsWith(prefix)) continue;
        let changed = false;
        const next = arr.map((m) => {
          if (m.id !== messageId) return m;
          changed = true;
          return { ...m, content, editedAt: Date.now() };
        });
        if (changed) threads[key] = next;
      }
      return { channels: { ...s.channels }, threads };
    });
  },
  remove(channelId, messageId) {
    set((s) => {
      const ch = ensure(s, channelId);
      for (const m of ch.bySeq.values()) {
        if (m.id === messageId) m.deletedAt = Date.now();
      }
      const prefix = `${channelId}:`;
      const threads = { ...s.threads };
      for (const [key, arr] of Object.entries(threads)) {
        if (!key.startsWith(prefix)) continue;
        let changed = false;
        const next = arr.map((m) => {
          if (m.id !== messageId) return m;
          changed = true;
          return { ...m, deletedAt: Date.now() };
        });
        if (changed) threads[key] = next;
      }
      return { channels: { ...s.channels }, threads };
    });
  },
  setReactions(channelId, messageSeq, reactions) {
    set((s) => {
      const ch = s.channels[channelId];
      if (ch) {
        const m = ch.bySeq.get(messageSeq);
        if (m) m.reactions = reactions;
      }
      const threads = { ...s.threads };
      const prefix = `${channelId}:`;
      for (const [key, arr] of Object.entries(threads)) {
        if (!key.startsWith(prefix)) continue;
        const idx = arr.findIndex((x) => x.seq === messageSeq);
        if (idx === -1) continue;
        const next = [...arr];
        next[idx] = { ...next[idx], reactions };
        threads[key] = next;
      }
      return { channels: ch ? { ...s.channels } : s.channels, threads };
    });
  },
  ingestThread(channelId, message) {
    set((s) => {
      if (!message.parentId) return s;
      const key = `${channelId}:${message.parentId}`;
      const arr = s.threads[key] ?? [];
      if (arr.some((m) => m.id === message.id)) return s;
      const next = [...arr, { ...message }].sort((a, b) => a.seq - b.seq);
      return { threads: { ...s.threads, [key]: next } };
    });
  },
  threadList(channelId, parentId) {
    return get().threads[`${channelId}:${parentId}`] ?? [];
  },
}));
