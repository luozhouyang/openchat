import type { Message } from "protocol";
import type { SqliteDriver } from "./driver.ts";
import type { SqliteTxRunner } from "./tx.ts";
import type { ChannelQuery, MessagePage, MessageRepository } from "./types.ts";

function json(v: unknown): string | null {
  return v === null || v === undefined ? null : JSON.stringify(v);
}

function unjson<T>(v: string | null): T | null {
  return v === null ? null : (JSON.parse(v) as T);
}

function rowToMessage(r: {
  message_id: string;
  seq: number;
  user_id: string;
  parent_id: string | null;
  type: string;
  content: string;
  attachments: string | null;
  mentions: string | null;
  edited_at: number | null;
  deleted_at: number | null;
  created_at: number;
  is_pinned: number | null;
}): Message {
  return {
    id: r.message_id,
    seq: r.seq,
    userId: r.user_id,
    parentId: r.parent_id,
    type: r.type as Message["type"],
    content: r.content,
    attachments: unjson<unknown[]>(r.attachments),
    mentions: unjson<string[]>(r.mentions),
    editedAt: r.edited_at,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    isPinned: r.is_pinned === 1,
  };
}

type MessageRow = Parameters<typeof rowToMessage>[0];

const UPSERT = `
INSERT INTO messages (channel_id, seq, message_id, user_id, parent_id, type, content, attachments, mentions, edited_at, deleted_at, created_at, is_pinned)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (channel_id, message_id) DO UPDATE SET
  seq = excluded.seq,
  content = excluded.content,
  attachments = excluded.attachments,
  mentions = excluded.mentions,
  edited_at = excluded.edited_at,
  deleted_at = excluded.deleted_at,
  is_pinned = excluded.is_pinned
`;

export class SqliteMessageRepository implements MessageRepository {
  private d: SqliteDriver;
  private tx: SqliteTxRunner;

  constructor(d: SqliteDriver, tx: SqliteTxRunner) {
    this.d = d;
    this.tx = tx;
  }

  async append(channelId: string, message: Message) {
    await this.d.run(UPSERT, this.params(channelId, message));
  }

  async applyGap(channelId: string, messages: Message[]) {
    if (messages.length === 0) {
      return;
    }
    // One transaction per gap (joins an outer transaction when the caller
    // wrapped it): a 500-message refill is a single commit, not 500.
    await this.tx.run(async () => {
      for (const m of messages) {
        await this.d.run(UPSERT, this.params(channelId, m));
      }
    });
  }

  async query(channelId: string, opts: ChannelQuery): Promise<MessagePage> {
    const where = opts.beforeSeq === undefined ? "channel_id = ?" : "channel_id = ? AND seq < ?";
    const args: unknown[] =
      opts.beforeSeq === undefined ? [channelId] : [channelId, opts.beforeSeq];
    const rows = await this.d.all<MessageRow>(
      `SELECT * FROM messages WHERE ${where} ORDER BY seq ASC LIMIT ?`,
      [...args, opts.limit + 1],
    );
    const hasMore = rows.length > opts.limit;
    return {
      rows: rows.slice(0, opts.limit).map(rowToMessage),
      hasMore,
    };
  }

  async maxSeq(channelId: string): Promise<number> {
    const row = await this.d.get<{ v: number }>(
      "SELECT COALESCE(MAX(seq), 0) AS v FROM messages WHERE channel_id = ?",
      [channelId],
    );
    return row?.v ?? 0;
  }

  async listChannels(): Promise<string[]> {
    const rows = await this.d.all<{ channel_id: string }>(
      "SELECT DISTINCT channel_id FROM messages",
    );
    return rows.map((r) => r.channel_id);
  }

  async edit(channelId: string, messageId: string, content: string, editedAt: number) {
    await this.d.run(
      "UPDATE messages SET content = ?, edited_at = ? WHERE channel_id = ? AND message_id = ?",
      [content, editedAt, channelId, messageId],
    );
  }

  async remove(channelId: string, messageId: string) {
    await this.d.run("UPDATE messages SET deleted_at = ? WHERE channel_id = ? AND message_id = ?", [
      Date.now(),
      channelId,
      messageId,
    ]);
  }

  async setPinned(channelId: string, messageId: string, pinned: boolean) {
    await this.d.run("UPDATE messages SET is_pinned = ? WHERE channel_id = ? AND message_id = ?", [
      pinned ? 1 : 0,
      channelId,
      messageId,
    ]);
  }

  private params(channelId: string, m: Message): unknown[] {
    return [
      channelId,
      m.seq,
      m.id,
      m.userId,
      m.parentId,
      m.type,
      m.content,
      json(m.attachments),
      json(m.mentions),
      m.editedAt,
      m.deletedAt,
      m.createdAt,
      m.isPinned ?? false,
    ];
  }
}
