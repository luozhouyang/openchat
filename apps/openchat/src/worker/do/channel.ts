import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { and, asc, count, desc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { id, userDoName, isAllowedEmoji, type MessageType, type NotifPref } from "protocol";
import migrations from "../../../migrations/channel-do/migrations";
import * as schema from "../db/schema-channel-do.ts";
import * as schemaD1 from "../db/schema-d1.ts";
import { getDb } from "../db/client.ts";
import { setThumbnail } from "../db/repos/uploads.ts";
import { createBroadcaster } from "./broadcast.ts";
import { createReactionBatcher } from "./reaction-batch.ts";

interface HistoryMessage {
  id: string;
  seq: number;
  userId: string;
  parentId: string | null;
  type: MessageType;
  content: string;
  attachments: Record<string, string | number | boolean>[] | null;
  mentions: string[] | null;
  isPinned: boolean;
  hasReactions: boolean;
  editedAt: number | null;
  updatedAt: number | null;
  deletedAt: number | null;
  createdAt: number;
}

interface ThreadInfo {
  postId: string;
  replyCount: number;
  lastReplyAt: number | null;
  participants: string[];
  channelId: string | null;
}

/**
 * Channels at or below this member count broadcast to every member (relying on
 * UserDO.push's cheap short-circuit); larger channels filter targets via D1
 * `user_status.online`. Tuned so one D1 read ≈ one offline-UserDO wake-up.
 */
const SMALL_CHANNEL_THRESHOLD = 16;

export class ChannelDO extends DurableObject<Env> {
  db: ReturnType<typeof drizzle>;
  channelId = (this.ctx.id.name ?? "").slice("channel:".length);
  rates = new Map<string, number[]>();
  failedPush = new Map<string, number>();
  broadcaster = createBroadcaster({
    env: { ...this.env, channelId: this.channelId },
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

  async setPushSubscribed(body: { userId: string; subscribed: boolean }): Promise<void> {
    await this.db
      .update(schema.memberState)
      .set({ pushSubscribed: body.subscribed })
      .where(eq(schema.memberState.userId, body.userId));
  }

  async health(): Promise<{ ok: boolean; members: number; online: number }> {
    const members = (await this.db.select().from(schema.memberState)).length;
    const online =
      (
        await this.fetchOnlineMemberIds(
          (
            await this.db.select({ userId: schema.memberState.userId }).from(schema.memberState)
          ).map((r) => r.userId),
        )
      )?.length ?? 0;
    return { ok: true, members, online };
  }

  async count(): Promise<{ count: number }> {
    const rows = await this.db.select({ n: count() }).from(schema.messages);
    return { count: Number(rows[0]?.n ?? 0) };
  }

  async readMark(body: {
    userId: string;
    seq: number;
  }): Promise<{ error: string; status: 403 } | { lastReadSeq: number }> {
    const memberRows = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, body.userId))
      .limit(1);
    const member = memberRows[0];
    if (!member) return { error: "not a member", status: 403 };
    const newRead = Math.max(member.lastReadSeq, body.seq);
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

  async setNotifPref(body: {
    userId: string;
    pref: "all" | "mention" | "none";
  }): Promise<{ ok: boolean } | { error: string; status: 403 | 422 }> {
    if (body.pref !== "all" && body.pref !== "mention" && body.pref !== "none") {
      return { error: "invalid", status: 422 };
    }
    const member = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, body.userId))
      .limit(1);
    if (member.length === 0) return { error: "not a member", status: 403 };
    await this.db
      .update(schema.memberState)
      .set({ notifPref: body.pref })
      .where(eq(schema.memberState.userId, body.userId));
    return { ok: true };
  }

  async unread(
    userId: string,
  ): Promise<
    { error: string; status: 403 } | { maxSeq: number; lastReadSeq: number; mentionCount: number }
  > {
    const memberRows = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, userId))
      .limit(1);
    const member = memberRows[0];
    if (!member) return { error: "not a member", status: 403 };
    const maxRow = await this.db
      .select({ seq: schema.messages.seq })
      .from(schema.messages)
      .orderBy(desc(schema.messages.seq))
      .limit(1);
    const maxSeq = maxRow[0]?.seq ?? 0;
    return { maxSeq, lastReadSeq: member.lastReadSeq, mentionCount: member.mentionCount };
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
    const dupRows = await this.db
      .select()
      .from(schema.dedupTokens)
      .where(
        and(
          eq(schema.dedupTokens.userId, senderUserId),
          eq(schema.dedupTokens.token, body.clientToken),
        ),
      )
      .limit(1);
    const dup = dupRows[0];
    if (dup) {
      const msgRows = await this.db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.seq, dup.messageSeq))
        .limit(1);
      const msg = msgRows[0];
      return { messageId: msg!.id, seq: msg!.seq, deduplicated: true };
    }
    if (body.parentId) {
      const rootRows = await this.db
        .select({ id: schema.messages.id, deletedAt: schema.messages.deletedAt })
        .from(schema.messages)
        .where(eq(schema.messages.id, body.parentId))
        .limit(1);
      const root = rootRows[0];
      if (!root || root.deletedAt !== null) {
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
    const messageId = id("msg");
    const result = await this.db
      .insert(schema.messages)
      .values({
        id: messageId,
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
      const memberRows = await this.db
        .select()
        .from(schema.memberState)
        .where(eq(schema.memberState.userId, userId))
        .limit(1);
      if (memberRows.length > 0) {
        const m = memberRows[0];
        await this.db
          .update(schema.memberState)
          .set({ mentionCount: m.mentionCount + 1 })
          .where(eq(schema.memberState.userId, userId));
      }
    }
    const fullMessage = this.rowToMessage(msg);
    if (body.parentId) {
      await this.upsertThread(body.parentId, senderUserId, now);
    }
    await this.broadcast({ type: "message.new", message: fullMessage });
    if (body.parentId) {
      await this.notifyThreadSubscribers(body.parentId, senderUserId, fullMessage);
    }
    return { messageId: msg.id, seq: msg.seq };
  }

  private async upsertThread(postId: string, senderUserId: string, at: number) {
    const existingRows = await this.db
      .select()
      .from(schema.threads)
      .where(eq(schema.threads.postId, postId))
      .limit(1);
    const existing = existingRows[0];
    if (existing) {
      const participants = JSON.parse(existing.participants ?? "[]") as string[];
      if (!participants.includes(senderUserId)) participants.push(senderUserId);
      await this.db
        .update(schema.threads)
        .set({
          replyCount: existing.replyCount + 1,
          lastReplyAt: at,
          participants: JSON.stringify(participants),
        })
        .where(eq(schema.threads.postId, postId));
    } else {
      await this.db.insert(schema.threads).values({
        postId,
        replyCount: 1,
        lastReplyAt: at,
        participants: JSON.stringify([senderUserId]),
        channelId: this.channelId,
      });
    }
  }

  private isChannelAdmin(role: string | null | undefined): boolean {
    return role?.split(" ").includes("channel_admin") ?? false;
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
    const callerRows = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, callerUserId))
      .limit(1);
    const callerRole = callerRows[0]?.role;
    const isAdmin = this.isChannelAdmin(callerRole);
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
    const row = rows[0];
    await this.db
      .update(schema.messages)
      .set({ attachments: JSON.stringify(body.attachments) })
      .where(eq(schema.messages.id, body.messageId));
    await this.broadcast({
      type: "message.edit",
      messageId: body.messageId,
      content: row.content,
      editedAt: Date.now(),
    });
  }

  async updateThumbByUpload(body: {
    uploadId: string;
    thumbUrl: string;
    thumbKey: string;
  }): Promise<{ ok: boolean }> {
    try {
      await setThumbnail(getDb(this.env.DB), {
        fileId: body.uploadId,
        thumbnailPath: body.thumbKey,
        previewPath: null,
      });
    } catch {}
    const rows = await this.db
      .select({
        id: schema.messages.id,
        content: schema.messages.content,
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
          content: r.content,
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
    const callerRows = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, callerUserId))
      .limit(1);
    const callerRole = callerRows[0]?.role;
    const isAdmin = this.isChannelAdmin(callerRole);
    if (msg.userId !== callerUserId && !isAdmin) return { error: "forbidden", status: 403 };
    await this.db
      .update(schema.messages)
      .set({ deletedAt: Date.now() })
      .where(eq(schema.messages.id, body.messageId));
    await this.broadcast({ type: "message.delete", messageId: body.messageId });
    return { ok: true };
  }

  async pinMessage(
    callerUserId: string,
    body: { messageId: string; pinned: boolean },
  ): Promise<{ error: string; status: 403 | 404 } | { ok: true }> {
    const rows = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, body.messageId))
      .limit(1);
    if (rows.length === 0) return { error: "not found", status: 404 };
    const msg = rows[0];
    const callerRows = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, callerUserId))
      .limit(1);
    const callerRole = callerRows[0]?.role;
    const isAdmin = this.isChannelAdmin(callerRole);
    if (msg.userId !== callerUserId && !isAdmin) return { error: "forbidden", status: 403 };
    await this.db
      .update(schema.messages)
      .set({ isPinned: body.pinned, updatedAt: Date.now() })
      .where(eq(schema.messages.id, body.messageId));
    await this.broadcast({
      type: "message.pinned",
      messageId: body.messageId,
      pinned: body.pinned,
    });
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
    return this.toggleReactionCore(callerUserId, body.messageSeq, body.emoji);
  }

  async toggleReactionByMessageId(
    callerUserId: string,
    body: { messageId: string; emoji: string },
  ): Promise<{ error: string; status: 403 | 404 | 422 } | void> {
    const rows = await this.db
      .select({ seq: schema.messages.seq })
      .from(schema.messages)
      .where(eq(schema.messages.id, body.messageId))
      .limit(1);
    if (rows.length === 0) return { error: "message not found", status: 404 };
    const row = rows[0];
    return this.toggleReactionCore(callerUserId, row.seq, body.emoji);
  }

  async reactionSnapshotByMessageId(
    messageId: string,
  ): Promise<{ error: string; status: 404 } | Record<string, string[]>> {
    const rows = await this.db
      .select({ seq: schema.messages.seq })
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .limit(1);
    if (rows.length === 0) return { error: "message not found", status: 404 };
    const row = rows[0];
    return this.reactionSnapshot(row.seq);
  }

  private async toggleReactionCore(
    callerUserId: string,
    messageSeq: number,
    emoji: string,
  ): Promise<{ error: string; status: 403 | 404 | 422 } | void> {
    if (!isAllowedEmoji(emoji)) return { error: "invalid emoji", status: 422 };
    const member = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, callerUserId))
      .limit(1);
    if (member.length === 0) return { error: "not a member", status: 403 };
    const msg = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.seq, messageSeq))
      .limit(1);
    if (msg.length === 0) return { error: "message not found", status: 404 };
    const existing = await this.db
      .select()
      .from(schema.reactions)
      .where(
        and(
          eq(schema.reactions.messageSeq, messageSeq),
          eq(schema.reactions.emoji, emoji),
          eq(schema.reactions.userId, callerUserId),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      await this.db
        .delete(schema.reactions)
        .where(
          and(
            eq(schema.reactions.messageSeq, messageSeq),
            eq(schema.reactions.emoji, emoji),
            eq(schema.reactions.userId, callerUserId),
          ),
        );
    } else {
      await this.db.insert(schema.reactions).values({
        messageSeq,
        emoji,
        userId: callerUserId,
        createdAt: Date.now(),
        updateAt: Date.now(),
      });
    }
    const remaining = await this.db
      .select({ n: count() })
      .from(schema.reactions)
      .where(eq(schema.reactions.messageSeq, messageSeq));
    const hasReactions = Number(remaining[0]?.n ?? 0) > 0;
    await this.db
      .update(schema.messages)
      .set({ hasReactions, updatedAt: Date.now() })
      .where(eq(schema.messages.seq, messageSeq));
    this.reactionBatcher.markDirty(messageSeq);
  }

  async getThread(
    postId: string,
  ): Promise<{ error: string; status: 404 } | { thread: ThreadInfo }> {
    const rows = await this.db
      .select()
      .from(schema.threads)
      .where(eq(schema.threads.postId, postId))
      .limit(1);
    if (rows.length === 0) return { error: "not found", status: 404 };
    const row = rows[0];
    return {
      thread: {
        postId: row.postId,
        replyCount: row.replyCount,
        lastReplyAt: row.lastReplyAt,
        participants: JSON.parse(row.participants ?? "[]") as string[],
        channelId: row.channelId,
      },
    };
  }

  async threadsForUser(userId: string): Promise<{ threads: ThreadInfo[] }> {
    const rows = await this.db.select().from(schema.threads);
    const threads = rows
      .filter((r) => (JSON.parse(r.participants ?? "[]") as string[]).includes(userId))
      .map((r) => ({
        postId: r.postId,
        replyCount: r.replyCount,
        lastReplyAt: r.lastReplyAt,
        participants: JSON.parse(r.participants ?? "[]") as string[],
        channelId: r.channelId,
      }));
    return { threads };
  }

  async threadMarkRead(
    userId: string,
    body: { postId: string },
  ): Promise<{ error: string; status: 403 } | { ok: true }> {
    const member = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, userId))
      .limit(1);
    if (member.length === 0) return { error: "not a member", status: 403 };
    const now = Date.now();
    await this.db
      .insert(schema.threadMemberships)
      .values({ postId: body.postId, userId, following: true, lastViewed: now, unreadMentions: 0 })
      .onConflictDoUpdate({
        target: [schema.threadMemberships.postId, schema.threadMemberships.userId],
        set: { lastViewed: now, unreadMentions: 0 },
      });
    return { ok: true };
  }

  async threadFollow(
    userId: string,
    body: { postId: string; following: boolean },
  ): Promise<{ error: string; status: 403 } | { ok: true }> {
    const member = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, userId))
      .limit(1);
    if (member.length === 0) return { error: "not a member", status: 403 };
    await this.db
      .insert(schema.threadMemberships)
      .values({ postId: body.postId, userId, following: body.following })
      .onConflictDoUpdate({
        target: [schema.threadMemberships.postId, schema.threadMemberships.userId],
        set: { following: body.following },
      });
    return { ok: true };
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
      type: r.type as MessageType,
      content: r.deletedAt !== null ? "" : r.content,
      attachments: r.attachments ? JSON.parse(r.attachments) : null,
      mentions: r.mentions ? JSON.parse(r.mentions) : null,
      isPinned: r.isPinned,
      hasReactions: r.hasReactions,
      editedAt: r.editedAt,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
      createdAt: r.createdAt,
    };
  }

  private async broadcast(event: { type: string; [k: string]: unknown }) {
    // Presence lives centrally in D1 `user_status` (single source of truth).
    // The target filter is an *optimization* to avoid waking hibernated offline
    // User DOs, not a correctness requirement: UserDO.push cheaply short-circuits
    // (foreground / pref / mention / push-subscription checks).
    //   - small channels: target all members (0 network hops before the fan-out);
    //   - large channels: one D1 IN-list query for online members, then merge the
    //     offline-but-push-subscribed members locally.
    // D1 failure degrades to target-all so delivery never blocks on it.
    const wantsPush = event.type === "message.new";
    const rows = await this.db
      .select({
        userId: schema.memberState.userId,
        notifPref: schema.memberState.notifPref,
        pushSubscribed: schema.memberState.pushSubscribed,
      })
      .from(schema.memberState);
    const prefs = new Map<string, NotifPref>();
    for (const row of rows) prefs.set(row.userId, row.notifPref as NotifPref);

    let targets: string[];
    if (rows.length <= SMALL_CHANNEL_THRESHOLD) {
      targets = rows.map((r) => r.userId);
    } else {
      const online = await this.fetchOnlineMemberIds(rows.map((r) => r.userId));
      if (online === null) {
        targets = rows.map((r) => r.userId);
      } else {
        const onlineSet = new Set(online);
        targets = rows
          .filter((r) =>
            wantsPush
              ? onlineSet.has(r.userId) || (r.pushSubscribed && r.notifPref !== "none")
              : onlineSet.has(r.userId),
          )
          .map((r) => r.userId);
      }
    }
    await this.broadcaster.broadcast(event, prefs, targets);
  }

  /** Online member ids from D1 `user_status`; `null` signals a D1 failure. */
  private async fetchOnlineMemberIds(ids: string[]): Promise<string[] | null> {
    try {
      const out: string[] = [];
      for (let i = 0; i < ids.length; i += 900) {
        const chunk = ids.slice(i, i + 900);
        const rows = await getDb(this.env.DB)
          .select({ userId: schemaD1.userStatus.userId })
          .from(schemaD1.userStatus)
          .where(
            and(eq(schemaD1.userStatus.online, true), inArray(schemaD1.userStatus.userId, chunk)),
          );
        for (const r of rows) out.push(r.userId);
      }
      return out;
    } catch {
      return null;
    }
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
