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
