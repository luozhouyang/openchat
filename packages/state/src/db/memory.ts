import type { Message } from "protocol";
import type { ChannelQuery, MessagePage, MessageRepository } from "./types.ts";

interface ChannelState {
  byId: Map<string, Message>;
  bySeq: Map<number, string>;
}

function ensure(map: Map<string, ChannelState>, channelId: string): ChannelState {
  let s = map.get(channelId);
  if (!s) {
    s = { byId: new Map(), bySeq: new Map() };
    map.set(channelId, s);
  }
  return s;
}

function applyUpsert(ch: ChannelState, message: Message) {
  const existing = ch.byId.get(message.id);
  if (existing) ch.bySeq.delete(existing.seq);
  ch.byId.set(message.id, message);
  ch.bySeq.set(message.seq, message.id);
}

/**
 * Session-scoped implementation for environments without SQLite (no
 * Worker/OPFS). Same semantics as the SQLite repository — pinned by the
 * shared contract tests.
 */
export class MemoryMessageRepository implements MessageRepository {
  private channels = new Map<string, ChannelState>();

  async append(channelId: string, message: Message) {
    const ch = ensure(this.channels, channelId);
    applyUpsert(ch, message);
  }

  async applyGap(channelId: string, messages: Message[]) {
    const ch = ensure(this.channels, channelId);
    for (const m of messages) applyUpsert(ch, m);
  }

  async query(channelId: string, opts: ChannelQuery): Promise<MessagePage> {
    const ch = this.channels.get(channelId);
    if (!ch) return { rows: [], hasMore: false };
    const seqs = [...ch.bySeq.keys()]
      .filter((s) => opts.beforeSeq === undefined || s < opts.beforeSeq)
      .sort((a, b) => a - b);
    const page = seqs.slice(0, opts.limit);
    return {
      rows: page.map((s) => ch.byId.get(ch.bySeq.get(s)!)!),
      hasMore: seqs.length > opts.limit,
    };
  }

  async maxSeq(channelId: string): Promise<number> {
    const ch = this.channels.get(channelId);
    if (!ch) return 0;
    let max = 0;
    for (const s of ch.bySeq.keys()) if (s > max) max = s;
    return max;
  }

  async listChannels(): Promise<string[]> {
    return [...this.channels.keys()];
  }

  async edit(channelId: string, messageId: string, content: string, editedAt: number) {
    const ch = this.channels.get(channelId);
    const m = ch?.byId.get(messageId);
    if (m) {
      m.content = content;
      m.editedAt = editedAt;
    }
  }

  async remove(channelId: string, messageId: string) {
    const ch = this.channels.get(channelId);
    const m = ch?.byId.get(messageId);
    if (m) m.deletedAt = Date.now();
  }

  clear() {
    this.channels.clear();
  }
}
