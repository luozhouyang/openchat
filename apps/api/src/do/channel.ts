import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { and, asc, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { newId, userDoName, isAllowedEmoji } from "protocol";
import migrations from "../../migrations/channel-do/migrations";
import * as schema from "../db/schema-channel-do.ts";
import { createBroadcaster } from "./broadcast.ts";
import { createReactionBatcher } from "./reaction-batch.ts";

interface HistoryMessage {
  id: string;
  seq: number;
  userId: string;
  parentId: string | null;
  type: string;
  content: string;
  attachments: Record<string, string | number | boolean>[] | null;
  mentions: string[] | null;
  editedAt: number | null;
  deletedAt: number | null;
  createdAt: number;
}

export class ChannelDO extends DurableObject<Env> {
  db: ReturnType<typeof drizzle>;
  channelId = (this.ctx.id.name ?? "").slice("channel:".length);
  subscribers = new Map<string, { userId: string }>();
  rates = new Map<string, number[]>();
  failedPush = new Map<string, number>();
  broadcaster = createBroadcaster({
    env: { ...this.env, channelId: this.channelId },
    subscribers: () => this.subscribers.keys(),
    onPushFailed: (userId) => {
      this.failedPush.set(userId, (this.failedPush.get(userId) ?? 0) + 1);
    },
  });
  reactionBatcher = createReactionBatcher({
    getSnapshot: (seq) => this.reactionSnapshot(seq),
    broadcast: (event) => this.broadcast(event),
  });

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema, logger: false });
    void ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations);
    });
  }

  async membersAdd(body: { userId: string; role: string }): Promise<void> {
    await this.db
      .insert(schema.memberState)
      .values({ userId: body.userId, role: body.role ?? "member", joinedAt: Date.now() })
      .onConflictDoUpdate({
        target: schema.memberState.userId,
        set: { role: body.role ?? "member" },
      });
  }

  async membersRemove(body: { userId: string }): Promise<void> {
    await this.db.delete(schema.memberState).where(eq(schema.memberState.userId, body.userId));
    this.subscribers.delete(body.userId);
  }

  async typing(callerUserId: string): Promise<{ error: string; status: 403 } | void> {
    const member = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, callerUserId))
      .limit(1);
    if (member.length === 0) return { error: "not a member", status: 403 };
    await this.broadcast({
      type: "typing.start",
      userId: callerUserId,
      expiresAt: Date.now() + 5000,
    });
  }

  async subscribe(body: { userId: string }): Promise<{ ok: boolean }> {
    const member = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, body.userId))
      .limit(1);
    if (member.length === 0) return { ok: false };
    this.subscribers.set(body.userId, { userId: body.userId });
    return { ok: true };
  }

  async unsubscribe(body: { userId: string }): Promise<void> {
    this.subscribers.delete(body.userId);
  }

  async health(): Promise<{ ok: boolean; members: number; subscribers: number }> {
    const members = (await this.db.select().from(schema.memberState)).length;
    return { ok: true, members, subscribers: this.subscribers.size };
  }

  async readMark(body: {
    userId: string;
    seq: number;
  }): Promise<{ error: string; status: 403 } | { lastReadSeq: number }> {
    const member = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, body.userId))
      .limit(1);
    if (member.length === 0) return { error: "not a member", status: 403 };
    const newRead = Math.max(member[0].lastReadSeq, body.seq);
    await this.db
      .update(schema.memberState)
      .set({ lastReadSeq: newRead, mentionCount: 0 })
      .where(eq(schema.memberState.userId, body.userId));
    await this.pushToUser(body.userId, {
      type: "channel.read",
      channelId: this.channelId,
      lastReadSeq: newRead,
    });
    return { lastReadSeq: newRead };
  }

  async unread(
    userId: string,
  ): Promise<
    { error: string; status: 403 } | { maxSeq: number; lastReadSeq: number; mentionCount: number }
  > {
    const member = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, userId))
      .limit(1);
    if (member.length === 0) return { error: "not a member", status: 403 };
    const maxRow = await this.db
      .select({ seq: schema.messages.seq })
      .from(schema.messages)
      .orderBy(desc(schema.messages.seq))
      .limit(1);
    const maxSeq = maxRow[0]?.seq ?? 0;
    return { maxSeq, lastReadSeq: member[0].lastReadSeq, mentionCount: member[0].mentionCount };
  }

  async postMessage(
    senderUserId: string,
    body: {
      content: string;
      parentId?: string;
      clientToken: string;
      type?: "text" | "file";
      attachments?: unknown[];
    },
  ): Promise<
    | { messageId: string; seq: number; deduplicated?: boolean }
    | { error: string; status: 403 | 422 | 429 }
  > {
    if (body.content.length > 16384 || (body.type !== "file" && !body.content))
      return { error: "invalid", status: 422 };
    const member = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, senderUserId))
      .limit(1);
    if (member.length === 0) return { error: "not a member", status: 403 };
    const now = Date.now();
    const hits = (this.rates.get(senderUserId) ?? []).filter((t) => now - t < 1000);
    if (hits.length >= 5) return { error: "rate limited", status: 429 };
    hits.push(now);
    this.rates.set(senderUserId, hits);
    const dup = await this.db
      .select()
      .from(schema.dedupTokens)
      .where(
        and(
          eq(schema.dedupTokens.userId, senderUserId),
          eq(schema.dedupTokens.token, body.clientToken),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      const msg = await this.db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.seq, dup[0].messageSeq))
        .limit(1);
      return { messageId: msg[0].id, seq: msg[0].seq, deduplicated: true };
    }
    if (body.parentId) {
      const root = await this.db
        .select({ id: schema.messages.id, deletedAt: schema.messages.deletedAt })
        .from(schema.messages)
        .where(eq(schema.messages.id, body.parentId))
        .limit(1);
      if (root.length === 0 || root[0].deletedAt !== null) {
        return { error: "parent not found", status: 422 };
      }
    }
    const mentionPattern = /@\[([a-zA-Z0-9]+)\]/g;
    const mentions: string[] = [];
    for (const m of body.content.matchAll(mentionPattern)) {
      if (!mentions.includes(m[1])) mentions.push(m[1]);
    }
    const validMentions: string[] = [];
    for (const userId of mentions) {
      const member = await this.db
        .select()
        .from(schema.memberState)
        .where(eq(schema.memberState.userId, userId))
        .limit(1);
      if (member.length > 0) validMentions.push(userId);
    }
    const id = newId();
    const result = await this.db
      .insert(schema.messages)
      .values({
        id,
        userId: senderUserId,
        parentId: body.parentId ?? null,
        type: body.type === "file" ? "file" : "text",
        content: body.type === "file" ? "" : body.content,
        attachments: body.attachments ? JSON.stringify(body.attachments) : null,
        mentions: validMentions.length ? JSON.stringify(validMentions) : null,
        createdAt: now,
      })
      .returning();
    const msg = result[0];
    await this.db.insert(schema.dedupTokens).values({
      userId: senderUserId,
      token: body.clientToken,
      messageSeq: msg.seq,
      createdAt: now,
    });
    await this.updateMeta(msg.id, senderUserId, body.content, now);
    for (const userId of validMentions) {
      if (userId === senderUserId) continue;
      const member = await this.db
        .select()
        .from(schema.memberState)
        .where(eq(schema.memberState.userId, userId))
        .limit(1);
      if (member.length > 0) {
        await this.db
          .update(schema.memberState)
          .set({ mentionCount: member[0].mentionCount + 1 })
          .where(eq(schema.memberState.userId, userId));
      }
    }
    const fullMessage = this.rowToMessage(msg);
    await this.broadcast({ type: "message.new", message: fullMessage });
    if (body.parentId) {
      await this.notifyThreadSubscribers(body.parentId, senderUserId, fullMessage);
    }
    return { messageId: msg.id, seq: msg.seq };
  }

  async editMessage(
    callerUserId: string,
    body: { messageId: string; content: string },
  ): Promise<{ error: string; status: 404 | 410 | 403 | 422 } | { ok: true }> {
    const rows = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, body.messageId))
      .limit(1);
    if (rows.length === 0) return { error: "not found", status: 404 };
    const msg = rows[0];
    if (msg.deletedAt !== null) return { error: "deleted", status: 410 };
    const caller = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, callerUserId))
      .limit(1);
    const isAdmin = caller[0]?.role === "admin";
    if (msg.userId !== callerUserId && !isAdmin) return { error: "forbidden", status: 403 };
    if (!body.content || body.content.length > 16384) return { error: "invalid", status: 422 };
    const editedAt = Date.now();
    await this.db
      .update(schema.messages)
      .set({ content: body.content, editedAt })
      .where(eq(schema.messages.id, body.messageId));
    await this.broadcast({
      type: "message.edit",
      messageId: body.messageId,
      content: body.content,
      editedAt,
    });
    return { ok: true };
  }

  async updateAttachments(body: {
    messageId: string;
    attachments: unknown[];
  }): Promise<{ error: string; status: 404 } | void> {
    const rows = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, body.messageId))
      .limit(1);
    if (rows.length === 0) return { error: "not found", status: 404 };
    await this.db
      .update(schema.messages)
      .set({ attachments: JSON.stringify(body.attachments) })
      .where(eq(schema.messages.id, body.messageId));
    await this.broadcast({
      type: "message.edit",
      messageId: body.messageId,
      content: rows[0].content,
      editedAt: Date.now(),
    });
  }

  async updateThumbByUpload(body: {
    uploadId: string;
    thumbUrl: string;
    thumbKey: string;
  }): Promise<{ ok: boolean }> {
    const rows = await this.db
      .select({
        id: schema.messages.id,
        seq: schema.messages.seq,
        attachments: schema.messages.attachments,
      })
      .from(schema.messages);
    for (const r of rows) {
      if (!r.attachments) continue;
      const atts = JSON.parse(r.attachments) as { fileId?: string; thumbUrl?: string }[];
      let changed = false;
      for (const a of atts) {
        if (a.fileId === body.uploadId) {
          a.thumbUrl = body.thumbUrl;
          changed = true;
        }
      }
      if (changed) {
        await this.db
          .update(schema.messages)
          .set({ attachments: JSON.stringify(atts) })
          .where(eq(schema.messages.id, r.id));
        await this.broadcast({
          type: "message.edit",
          messageId: r.id,
          content: "",
          editedAt: Date.now(),
        });
      }
    }
    return { ok: true };
  }

  async deleteMessage(
    callerUserId: string,
    body: { messageId: string },
  ): Promise<{ error: string; status: 404 | 403 } | { ok: true }> {
    const rows = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, body.messageId))
      .limit(1);
    if (rows.length === 0) return { error: "not found", status: 404 };
    const msg = rows[0];
    if (msg.deletedAt !== null) return { ok: true };
    const caller = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, callerUserId))
      .limit(1);
    const isAdmin = caller[0]?.role === "admin";
    if (msg.userId !== callerUserId && !isAdmin) return { error: "forbidden", status: 403 };
    await this.db
      .update(schema.messages)
      .set({ deletedAt: Date.now() })
      .where(eq(schema.messages.id, body.messageId));
    await this.broadcast({ type: "message.delete", messageId: body.messageId });
    return { ok: true };
  }

  async history(params: {
    limit?: number;
    beforeSeq?: number;
    afterSeq?: number;
    parentId?: string;
    order?: "asc" | "desc";
  }): Promise<{ messages: HistoryMessage[]; oldestSeq: number | null }> {
    const limit = Math.min(params.limit ?? 30, 500);
    const rows = await this.db
      .select()
      .from(schema.messages)
      .where(
        and(
          ...(params.parentId !== undefined
            ? [eq(schema.messages.parentId, params.parentId)]
            : [isNull(schema.messages.parentId)]),
          ...(params.beforeSeq !== undefined ? [lt(schema.messages.seq, params.beforeSeq)] : []),
          ...(params.afterSeq !== undefined ? [gt(schema.messages.seq, params.afterSeq)] : []),
        ),
      )
      .orderBy(params.order === "asc" ? asc(schema.messages.seq) : desc(schema.messages.seq))
      .limit(limit);
    const result = rows.map((r) => this.rowToMessage(r));
    return { messages: result, oldestSeq: result.length ? result[result.length - 1].seq : null };
  }

  async threadsSubscribe(body: { parentId: string; userId: string }): Promise<void> {
    await this.db
      .insert(schema.threadSubscriptions)
      .values({ parentId: body.parentId, userId: body.userId })
      .onConflictDoNothing();
  }

  async threadsUnsubscribe(body: { parentId: string; userId: string }): Promise<void> {
    await this.db
      .delete(schema.threadSubscriptions)
      .where(
        and(
          eq(schema.threadSubscriptions.parentId, body.parentId),
          eq(schema.threadSubscriptions.userId, body.userId),
        ),
      );
  }

  async meta(): Promise<Record<string, string>> {
    const rows = await this.db.select().from(schema.meta);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async reactionSnapshot(messageSeq: number): Promise<Record<string, string[]>> {
    const rows = await this.db
      .select()
      .from(schema.reactions)
      .where(eq(schema.reactions.messageSeq, messageSeq));
    const out: Record<string, string[]> = {};
    for (const r of rows) {
      (out[r.emoji] ??= []).push(r.userId);
    }
    return out;
  }

  async toggleReaction(
    callerUserId: string,
    body: { messageSeq: number; emoji: string },
  ): Promise<{ error: string; status: 403 | 404 | 422 } | void> {
    if (!isAllowedEmoji(body.emoji)) return { error: "invalid emoji", status: 422 };
    const member = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, callerUserId))
      .limit(1);
    if (member.length === 0) return { error: "not a member", status: 403 };
    const msg = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.seq, body.messageSeq))
      .limit(1);
    if (msg.length === 0) return { error: "message not found", status: 404 };
    const existing = await this.db
      .select()
      .from(schema.reactions)
      .where(
        and(
          eq(schema.reactions.messageSeq, body.messageSeq),
          eq(schema.reactions.emoji, body.emoji),
          eq(schema.reactions.userId, callerUserId),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      await this.db
        .delete(schema.reactions)
        .where(
          and(
            eq(schema.reactions.messageSeq, body.messageSeq),
            eq(schema.reactions.emoji, body.emoji),
            eq(schema.reactions.userId, callerUserId),
          ),
        );
    } else {
      await this.db.insert(schema.reactions).values({
        messageSeq: body.messageSeq,
        emoji: body.emoji,
        userId: callerUserId,
        createdAt: Date.now(),
      });
    }
    this.reactionBatcher.markDirty(body.messageSeq);
  }

  private async updateMeta(id: string, userId: string, content: string, at: number) {
    const pairs: [string, string][] = [
      ["last_message_id", id],
      ["last_message_user_id", userId],
      ["last_message_preview", content.slice(0, 100)],
      ["last_message_at", String(at)],
    ];
    for (const [key, value] of pairs) {
      await this.db
        .insert(schema.meta)
        .values({ key, value })
        .onConflictDoUpdate({ target: schema.meta.key, set: { value } });
    }
  }

  private rowToMessage(r: typeof schema.messages.$inferSelect): HistoryMessage {
    return {
      id: r.id,
      seq: r.seq,
      userId: r.userId,
      parentId: r.parentId,
      type: r.type,
      content: r.deletedAt !== null ? "" : r.content,
      attachments: r.attachments ? JSON.parse(r.attachments) : null,
      mentions: r.mentions ? JSON.parse(r.mentions) : null,
      editedAt: r.editedAt,
      deletedAt: r.deletedAt,
      createdAt: r.createdAt,
    };
  }

  private async broadcast(event: { type: string; [k: string]: unknown }) {
    await this.broadcaster.broadcast(event);
  }

  private async notifyThreadSubscribers(parentId: string, senderId: string, message: unknown) {
    const subs = await this.db
      .select()
      .from(schema.threadSubscriptions)
      .where(eq(schema.threadSubscriptions.parentId, parentId));
    for (const sub of subs) {
      if (sub.userId === senderId) continue;
      await this.pushToUser(sub.userId, { type: "thread.reply", parentId, message });
    }
  }

  private async pushToUser(userId: string, event: unknown) {
    try {
      const id = this.env.USER_DO.idFromName(userDoName(userId));
      await this.env.USER_DO.get(id).push({ channelId: this.channelId, events: [event] });
    } catch {}
  }

  async fetch(_request: Request): Promise<Response> {
    return new Response("not found", { status: 404 });
  }
}
