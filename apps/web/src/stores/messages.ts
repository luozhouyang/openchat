import { create } from "zustand";
import type { Message } from "protocol";

interface ChannelState {
  bySeq: Map<number, Message>;
  pending: Map<number, Message>;
  maxSeq: number;
}

interface MessageState {
  channels: Record<string, ChannelState>;
  reset: (channelId: string) => void;
  ingest: (channelId: string, message: Message) => void;
  applySync: (channelId: string, messages: Message[]) => void;
  list: (channelId: string) => Message[];
  maxSeq: (channelId: string) => number;
  ack: (channelId: string, clientToken: string, real: { id: string; seq: number }) => void;
  fail: (channelId: string, clientToken: string) => void;
  edit: (channelId: string, messageId: string, content: string) => void;
  remove: (channelId: string, messageId: string) => void;
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

function removeById(ch: ChannelState, id: string): Message | null {
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
      return { channels: { ...s.channels } };
    });
  },
  remove(channelId, messageId) {
    set((s) => {
      const ch = ensure(s, channelId);
      for (const m of ch.bySeq.values()) {
        if (m.id === messageId) m.deletedAt = Date.now();
      }
      return { channels: { ...s.channels } };
    });
  },
}));
