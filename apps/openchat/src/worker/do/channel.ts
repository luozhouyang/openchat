import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { id, userDoName, isAllowedEmoji, type MessageType, type NotifPref } from "protocol";
import migrations from "../../../migrations/channel-do/migrations";
import * as schema from "@worker/db/schema-channel-do";
import * as schemaD1 from "@worker/db/schema-d1";
import { getDb } from "@worker/db/client";
import { setThumbnail } from "@worker/db/repos/uploads";
import { createBroadcaster } from "@worker/do/broadcast";
import { createReactionBatcher } from "@worker/do/reaction-batch";

/**
 * Attachment payload as persisted on the message row. Kept structural (no
 * index signature) so the DO RPC type stays serializable.
 */
interface MessageAttachment {
  fileId: string;
  key?: string;
  name?: string;
  mime?: string;
  size?: number;
  thumbUrl?: string;
}

interface HistoryMessage {
  id: string;
  seq: number;
  userId: string;
  parentId: string | null;
  type: MessageType;
  content: string;
  attachments: MessageAttachment[] | null;
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

/** Transaction handle handed to `db.transaction` callbacks (drizzle durable-sqlite, sync runtime). */
type DoDatabase = ReturnType<typeof drizzle>;
type ChannelTx = Parameters<Parameters<DoDatabase["transaction"]>[0]>[0];

const HOUR_MS = 60 * 60 * 1000;

/** Top of the next full UTC hour (alarm cadence for ChannelDO housekeeping). */
function nextUtcHourStart(now = Date.now()): number {
  return (Math.floor(now / HOUR_MS) + 1) * HOUR_MS;
}

/**
 * dedup_tokens older than this are purged by `alarm()` (system design §4.3:
 * idempotency window). One row per (user, client token) must not grow forever.
 */
export const DEDUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Reserved for the message-retention policy (§6.2): messages older than this
 * would be eligible for deletion. NOT enforced yet — `alarm()` only purges
 * dedup tokens today; wire the actual message purge here when retention is
 * enabled (the `messages.created_at` index already exists for it).
 */
export const MESSAGE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

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
      await this.ensureHousekeepingAlarm();
    });
  }

  /**
   * dedup_tokens older than DEDUP_TOKEN_TTL_MS (module constant) are purged by
   * `alarm()`. Message retention uses the reserved MESSAGE_RETENTION_MS
   * constant; see module comments for the enforcement state.
   */
  private async ensureHousekeepingAlarm(): Promise<void> {
    try {
      const existing = await this.ctx.storage.getAlarm();
      if (existing !== null) {
        return;
      }
      await this.ctx.storage.setAlarm(nextUtcHourStart());
    } catch (err) {
      console.error("ChannelDO: failed to arm housekeeping alarm", err);
    }
  }

  async alarm(): Promise<void> {
    try {
      const cutoff = Date.now() - DEDUP_TOKEN_TTL_MS;
      await this.db.delete(schema.dedupTokens).where(lt(schema.dedupTokens.createdAt, cutoff));
      // Message retention (MESSAGE_RETENTION_MS) intentionally not enforced
      // here yet — reserved constant, no message deletion.
    } catch (err) {
      console.error("ChannelDO.alarm failed", err);
    } finally {
      try {
        await this.ctx.storage.setAlarm(nextUtcHourStart());
      } catch (err) {
        console.error("ChannelDO: failed to re-arm alarm", err);
      }
    }
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

  /**
   * Remove a member and everything tied to that membership (thread
   * subscriptions/memberships). Idempotent: returns false when the user is not
   * (or no longer) a member. Broadcasts a `channel.member_removed` structure
   * event to still-current targets plus the removed user.
   */
  async removeMember(userId: string): Promise<boolean> {
    if (!userId) {
      return false;
    }
    const rows = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, userId))
      .limit(1);
    if (rows.length === 0) {
      return false;
    }
    // Sync transaction: three member-tied tables drop atomically.
    // NB: this db is DO durable-sqlite (drizzle over `ctx.storage`), whose
    // transaction() maps to storage.transactionSync — the DO SQLite atomic
    // transaction. The D1 binding has no transaction interface; D1-side
    // multi-statement writes must use db.batch (see services/channel.service.ts).
    this.db.transaction((tx) => {
      tx.delete(schema.memberState).where(eq(schema.memberState.userId, userId)).run();
      tx.delete(schema.threadSubscriptions)
        .where(eq(schema.threadSubscriptions.userId, userId))
        .run();
      tx.delete(schema.threadMemberships).where(eq(schema.threadMemberships.userId, userId)).run();
    });
    const targets = new Set(await this.structureTargets());
    targets.add(userId);
    try {
      await Promise.all(
        [...targets].map((uid) => {
          const stub = this.env.USER_DO.get(this.env.USER_DO.idFromName(userDoName(uid)));
          return stub
            .pushStructure({ type: "channel.member_removed", channelId: this.channelId, userId })
            .catch(() => {});
        }),
      );
    } catch {}
    return true;
  }

  /**
   * Admin-semantic targeted removal: delete ONE user's ONE emoji reaction on a
   * message (unlike the toggle, the caller's identity is irrelevant). Resolves
   * the message via its unique `id` first (route layer only has postId).
   * Returns false for "message not found" (404 semantics) or an invalid emoji;
   * the caller (route layer) is responsible for authorization. Idempotent:
   * removing an already-absent reaction returns true.
   */
  async removeReactionByMessageId(
    targetUserId: string,
    messageId: string,
    emoji: string,
  ): Promise<boolean> {
    if (!isAllowedEmoji(emoji)) {
      return false;
    }
    const rows = await this.db
      .select({ seq: schema.messages.seq })
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .limit(1);
    if (rows.length === 0) {
      return false;
    }
    return this.removeReactionCore(targetUserId, rows[0].seq, emoji);
  }

  /**
   * Seq-based variant of `removeReactionByMessageId` (kept for callers that
   * already hold the message seq). Same boolean/404 semantics.
   */
  async removeReactionByUser(
    targetUserId: string,
    messageSeq: number,
    emoji: string,
  ): Promise<boolean> {
    if (!isAllowedEmoji(emoji)) {
      return false;
    }
    const msg = await this.db
      .select({ seq: schema.messages.seq })
      .from(schema.messages)
      .where(eq(schema.messages.seq, messageSeq))
      .limit(1);
    if (msg.length === 0) {
      return false;
    }
    return this.removeReactionCore(targetUserId, messageSeq, emoji);
  }

  private async removeReactionCore(
    targetUserId: string,
    messageSeq: number,
    emoji: string,
  ): Promise<boolean> {
    const removed = await this.db
      .delete(schema.reactions)
      .where(
        and(
          eq(schema.reactions.messageSeq, messageSeq),
          eq(schema.reactions.emoji, emoji),
          eq(schema.reactions.userId, targetUserId),
        ),
      )
      .returning();
    if (removed.length > 0) {
      await this.refreshReactionsFlag(messageSeq);
      this.reactionBatcher.markDirty(messageSeq);
    }
    return true;
  }

  private async refreshReactionsFlag(messageSeq: number): Promise<void> {
    const remaining = await this.db
      .select({ n: count() })
      .from(schema.reactions)
      .where(eq(schema.reactions.messageSeq, messageSeq));
    const hasReactions = Number(remaining[0]?.n ?? 0) > 0;
    await this.db
      .update(schema.messages)
      .set({ hasReactions, updatedAt: Date.now() })
      .where(eq(schema.messages.seq, messageSeq));
  }

  async structureTargets(): Promise<string[]> {
    const rows = await this.db
      .select({ userId: schema.memberState.userId })
      .from(schema.memberState);
    if (rows.length <= SMALL_CHANNEL_THRESHOLD) {
      return rows.map((r) => r.userId);
    }
    const online = await this.fetchOnlineMemberIds(rows.map((r) => r.userId));
    return online === null ? rows.map((r) => r.userId) : online;
  }

  async typing(callerUserId: string): Promise<{ error: string; status: 403 } | void> {
    const member = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, callerUserId))
      .limit(1);
    if (member.length === 0) {
      return { error: "not a member", status: 403 };
    }
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
    const memberRows = await this.db
      .select({ userId: schema.memberState.userId })
      .from(schema.memberState);
    const memberIds = memberRows.map((r) => r.userId);
    const onlineIds = await this.fetchOnlineMemberIds(memberIds);
    const online = onlineIds?.length ?? 0;
    return { ok: true, members: memberRows.length, online };
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
    if (!member) {
      return { error: "not a member", status: 403 };
    }
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
    if (member.length === 0) {
      return { error: "not a member", status: 403 };
    }
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
    if (!member) {
      return { error: "not a member", status: 403 };
    }
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
    if (body.content.length > 16384 || (body.type !== "file" && !body.content)) {
      return { error: "invalid", status: 422 };
    }
    const member = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, senderUserId))
      .limit(1);
    if (member.length === 0) {
      return { error: "not a member", status: 403 };
    }
    const now = Date.now();
    const hits = (this.rates.get(senderUserId) ?? []).filter((t) => now - t < 1000);
    if (hits.length >= 5) {
      return { error: "rate limited", status: 429 };
    }
    hits.push(now);
    this.rates.set(senderUserId, hits);
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
    const mentionPattern = /@\[([a-zA-Z0-9_-]+)\]/g;
    const mentions: string[] = [];
    let broadcastMention = false;
    for (const m of body.content.matchAll(mentionPattern)) {
      // `@[channel]` / `@[all]` are broadcast mention keywords, not user ids.
      if (m[1] === "channel" || m[1] === "all") {
        broadcastMention = true;
        continue;
      }
      if (!mentions.includes(m[1])) {
        mentions.push(m[1]);
      }
    }
    const validMentions: string[] = [];
    if (mentions.length > 0) {
      const memberRows = await this.db
        .select({ userId: schema.memberState.userId })
        .from(schema.memberState)
        .where(inArray(schema.memberState.userId, mentions));
      const found = new Set(memberRows.map((r) => r.userId));
      for (const userId of mentions) {
        if (found.has(userId)) {
          validMentions.push(userId);
        }
      }
    }
    const messageId = id("msg");
    // `postedAt` is stamped here so all transaction statements share one timestamp.
    const postedAt = Date.now();
    // Single sync transaction (input gate) for message + dedup token + meta +
    // thread upsert + mention counters: a crash after the message insert can no
    // longer defeat client-token idempotency, and all counters become
    // SQL-expression increments instead of read-then-write.
    // The driver here is DO durable-sqlite → storage.transactionSync (atomic),
    // NOT the D1 binding; D1 flows go through db.batch for atomicity.
    const outcome = this.db.transaction(
      (
        tx,
      ):
        | { kind: "dedup"; messageId: string; seq: number }
        | { kind: "stored"; msg: typeof schema.messages.$inferSelect } => {
        const dupRow = tx
          .select()
          .from(schema.dedupTokens)
          .where(
            and(
              eq(schema.dedupTokens.userId, senderUserId),
              eq(schema.dedupTokens.token, body.clientToken),
            ),
          )
          .get();
        if (dupRow) {
          const existing = tx
            .select()
            .from(schema.messages)
            .where(eq(schema.messages.seq, dupRow.messageSeq))
            .get();
          return { kind: "dedup", messageId: existing!.id, seq: existing!.seq };
        }
        // file_ids index column: populated at write time so that targeted
        // attachment lookups (thumbnail callbacks) never scan the whole table.
        const fileIds = (Array.isArray(body.attachments) ? body.attachments : [])
          .map((a) => (a as { fileId?: string }).fileId)
          .filter((f): f is string => typeof f === "string");
        const inserted = tx
          .insert(schema.messages)
          .values({
            id: messageId,
            userId: senderUserId,
            parentId: body.parentId ?? null,
            type: body.type === "file" ? "file" : "text",
            content: body.type === "file" ? "" : body.content,
            attachments: body.attachments ? JSON.stringify(body.attachments) : null,
            fileIds: fileIds.length ? JSON.stringify(fileIds) : null,
            mentions: validMentions.length ? JSON.stringify(validMentions) : null,
            createdAt: postedAt,
          })
          .returning()
          .get();
        const msg = inserted!;
        tx.insert(schema.dedupTokens)
          .values({
            userId: senderUserId,
            token: body.clientToken,
            messageSeq: msg.seq,
            createdAt: postedAt,
          })
          .run();
        for (const pair of this.metaPairs(msg.id, senderUserId, body.content, postedAt)) {
          this.metaSet(tx, pair[0], pair[1]);
        }
        if (body.parentId) {
          this.upsertThreadSync(tx, body.parentId, senderUserId, postedAt);
        }
        const mentionTargets = validMentions.filter((u) => u !== senderUserId);
        if (mentionTargets.length > 0) {
          tx.update(schema.memberState)
            .set({ mentionCount: sql`${schema.memberState.mentionCount} + 1` })
            .where(inArray(schema.memberState.userId, mentionTargets))
            .run();
        }
        // Broadcast keywords (@[channel]/@[all]) must count as a highlight for
        // every member's badge, mirroring the push-side isBroadcastMention
        // check (UserDO) — otherwise mentions-by-badge and mentions-by-push
        // disagree for the same message.
        if (broadcastMention) {
          tx.update(schema.memberState)
            .set({ mentionCount: sql`${schema.memberState.mentionCount} + 1` })
            .where(ne(schema.memberState.userId, senderUserId))
            .run();
        }
        return { kind: "stored", msg };
      },
    );
    if (outcome.kind === "dedup") {
      return { messageId: outcome.messageId, seq: outcome.seq, deduplicated: true };
    }
    const fullMessage = this.rowToMessage(outcome.msg);
    await this.broadcast({ type: "message.new", message: fullMessage });
    if (outcome.msg.parentId) {
      await this.notifyThreadSubscribers(outcome.msg.parentId, senderUserId, fullMessage);
    }
    return { messageId: outcome.msg.id, seq: outcome.msg.seq };
  }

  /** Meta rows that describe the latest message for sidebar previews. */
  private metaPairs(id: string, userId: string, content: string, at: number): [string, string][] {
    return [
      ["last_message_id", id],
      ["last_message_user_id", userId],
      ["last_message_preview", content.slice(0, 100)],
      ["last_message_at", String(at)],
    ];
  }

  private metaSet(tx: ChannelTx, key: string, value: string): void {
    tx.insert(schema.meta)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.meta.key, set: { value } })
      .run();
  }

  /** Thread upsert with SQL-side counters; must run inside a transaction. */
  private upsertThreadSync(tx: ChannelTx, postId: string, senderUserId: string, at: number): void {
    const existing = tx
      .select()
      .from(schema.threads)
      .where(eq(schema.threads.postId, postId))
      .get();
    if (existing) {
      const participants = JSON.parse(existing.participants ?? "[]") as string[];
      if (!participants.includes(senderUserId)) {
        participants.push(senderUserId);
      }
      tx.update(schema.threads)
        .set({
          replyCount: sql`${schema.threads.replyCount} + 1`,
          lastReplyAt: at,
          participants: JSON.stringify(participants),
        })
        .where(eq(schema.threads.postId, postId))
        .run();
    } else {
      tx.insert(schema.threads)
        .values({
          postId,
          replyCount: 1,
          lastReplyAt: at,
          participants: JSON.stringify([senderUserId]),
          channelId: this.channelId,
        })
        .run();
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
    if (rows.length === 0) {
      return { error: "not found", status: 404 };
    }
    const msg = rows[0];
    if (msg.deletedAt !== null) {
      return { error: "deleted", status: 410 };
    }
    const callerRows = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, callerUserId))
      .limit(1);
    const callerRole = callerRows[0]?.role;
    const isAdmin = this.isChannelAdmin(callerRole);
    if (msg.userId !== callerUserId && !isAdmin) {
      return { error: "forbidden", status: 403 };
    }
    if (!body.content || body.content.length > 16384) {
      return { error: "invalid", status: 422 };
    }
    const editedAt = Date.now();
    await this.db
      .update(schema.messages)
      .set({ content: body.content, editedAt })
      .where(eq(schema.messages.id, body.messageId));
    this.refreshLastMessageMeta(body.messageId, { editedContent: body.content });
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
    if (rows.length === 0) {
      return { error: "not found", status: 404 };
    }
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
    // Targeted lookup via the write-time file_ids index (json_each over the
    // indexed JSON); legacy rows predating file_ids fall back to the full scan
    // below only when the indexed query finds nothing.
    type AttachmentRow = {
      fileId?: string;
      thumbUrl?: string;
    };
    let candidateRows: {
      id: string;
      content: string;
      attachments: string | null;
    }[];
    try {
      candidateRows = await this.db
        .select({
          id: schema.messages.id,
          content: schema.messages.content,
          attachments: schema.messages.attachments,
        })
        .from(schema.messages)
        .where(
          sql`EXISTS (SELECT 1 FROM json_each(${schema.messages.fileIds}) WHERE json_each.value = ${body.uploadId})`,
        );
    } catch {
      candidateRows = [];
    }
    if (candidateRows.length === 0) {
      candidateRows = await this.db
        .select({
          id: schema.messages.id,
          content: schema.messages.content,
          attachments: schema.messages.attachments,
        })
        .from(schema.messages)
        .where(
          sql`${schema.messages.fileIds} IS NULL AND ${schema.messages.attachments} IS NOT NULL`,
        );
    }
    for (const r of candidateRows) {
      if (!r.attachments) {
        continue;
      }
      const atts = JSON.parse(r.attachments) as AttachmentRow[];
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
    if (rows.length === 0) {
      return { error: "not found", status: 404 };
    }
    const msg = rows[0];
    if (msg.deletedAt !== null) {
      return { ok: true };
    }
    const callerRows = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, callerUserId))
      .limit(1);
    const callerRole = callerRows[0]?.role;
    const isAdmin = this.isChannelAdmin(callerRole);
    if (msg.userId !== callerUserId && !isAdmin) {
      return { error: "forbidden", status: 403 };
    }
    await this.db
      .update(schema.messages)
      .set({ deletedAt: Date.now() })
      .where(eq(schema.messages.id, body.messageId));
    this.refreshLastMessageMeta(body.messageId, { deleted: true });
    await this.broadcast({ type: "message.delete", messageId: body.messageId });
    return { ok: true };
  }

  /**
   * Keep sidebar meta in step with the newest message:
   *  - edit: if the edited message is the channel's last message, refresh the preview;
   *  - delete: if the deleted message WAS the last message, recompute from the
   *    newest non-deleted message (preview stays empty-ish if none remain).
   */
  private refreshLastMessageMeta(
    messageId: string,
    opts: { editedContent?: string; deleted?: boolean } = {},
  ): void {
    // Sync transaction: preview recompute reads and writes stay atomic.
    // Same note as postMessage(): DO durable-sqlite storage.transactionSync,
    // not the D1 binding (D1 atomicity = db.batch).
    this.db.transaction((tx) => {
      const lastIdRow = tx
        .select()
        .from(schema.meta)
        .where(eq(schema.meta.key, "last_message_id"))
        .get();
      if (lastIdRow?.value !== messageId) {
        return;
      }
      if (opts.deleted) {
        const latest = tx
          .select()
          .from(schema.messages)
          .where(isNull(schema.messages.deletedAt))
          .orderBy(desc(schema.messages.seq))
          .limit(1)
          .all()[0];
        if (latest) {
          for (const pair of this.metaPairs(
            latest.id,
            latest.userId,
            latest.content,
            latest.createdAt,
          )) {
            this.metaSet(tx, pair[0], pair[1]);
          }
        } else {
          for (const pair of this.metaPairs("", "", "", 0) as [string, string][]) {
            this.metaSet(tx, pair[0], pair[1]);
          }
        }
        return;
      }
      if (opts.editedContent !== undefined) {
        this.metaSet(tx, "last_message_preview", opts.editedContent.slice(0, 100));
      }
    });
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
    if (rows.length === 0) {
      return { error: "not found", status: 404 };
    }
    const msg = rows[0];
    const callerRows = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, callerUserId))
      .limit(1);
    const callerRole = callerRows[0]?.role;
    const isAdmin = this.isChannelAdmin(callerRole);
    if (msg.userId !== callerUserId && !isAdmin) {
      return { error: "forbidden", status: 403 };
    }
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

  /** Case-insensitive substring search over top-level message content. */
  async searchMessages(params: {
    query: string;
    limit?: number;
  }): Promise<{ messages: HistoryMessage[] }> {
    const term = params.query.trim();
    if (term.length === 0) {
      return { messages: [] };
    }
    const limit = Math.min(params.limit ?? 50, 100);
    const rows = await this.db
      .select()
      .from(schema.messages)
      .where(
        and(
          isNull(schema.messages.parentId),
          sql`instr(lower(${schema.messages.content}), lower(${term})) > 0`,
        ),
      )
      .orderBy(desc(schema.messages.seq))
      .limit(limit);
    return { messages: rows.map((r) => this.rowToMessage(r)) };
  }

  /** Pinned top-level messages, newest pin first (channel pin panel). */
  async pinnedMessages(params: { limit?: number } = {}): Promise<{ messages: HistoryMessage[] }> {
    const limit = Math.min(params.limit ?? 50, 200);
    const rows = await this.db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.isPinned, true), isNull(schema.messages.parentId)))
      .orderBy(desc(schema.messages.seq))
      .limit(limit);
    return { messages: rows.map((r) => this.rowToMessage(r)) };
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
    if (rows.length === 0) {
      return { error: "message not found", status: 404 };
    }
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
    if (rows.length === 0) {
      return { error: "message not found", status: 404 };
    }
    const row = rows[0];
    return this.reactionSnapshot(row.seq);
  }

  private async toggleReactionCore(
    callerUserId: string,
    messageSeq: number,
    emoji: string,
  ): Promise<{ error: string; status: 403 | 404 | 422 } | void> {
    if (!isAllowedEmoji(emoji)) {
      return { error: "invalid emoji", status: 422 };
    }
    const member = await this.db
      .select()
      .from(schema.memberState)
      .where(eq(schema.memberState.userId, callerUserId))
      .limit(1);
    if (member.length === 0) {
      return { error: "not a member", status: 403 };
    }
    const msg = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.seq, messageSeq))
      .limit(1);
    if (msg.length === 0) {
      return { error: "message not found", status: 404 };
    }
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
    await this.refreshReactionsFlag(messageSeq);
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
    if (rows.length === 0) {
      return { error: "not found", status: 404 };
    }
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
    // json_each over the participants JSON does the membership filter in SQL so
    // the per-user thread list no longer scans the whole threads table in JS.
    const rows = await this.db
      .select()
      .from(schema.threads)
      .where(
        sql`EXISTS (SELECT 1 FROM json_each(${schema.threads.participants}) WHERE json_each.value = ${userId})`,
      );
    const threads = rows.map((r) => ({
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
    if (member.length === 0) {
      return { error: "not a member", status: 403 };
    }
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
    if (member.length === 0) {
      return { error: "not a member", status: 403 };
    }
    await this.db
      .insert(schema.threadMemberships)
      .values({ postId: body.postId, userId, following: body.following })
      .onConflictDoUpdate({
        target: [schema.threadMemberships.postId, schema.threadMemberships.userId],
        set: { following: body.following },
      });
    return { ok: true };
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
    for (const row of rows) {
      prefs.set(row.userId, row.notifPref as NotifPref);
    }

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
        for (const r of rows) {
          out.push(r.userId);
        }
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
      if (sub.userId === senderId) {
        continue;
      }
      await this.pushToUser(sub.userId, { type: "thread.reply", parentId, message });
    }
  }

  private async pushToUser(userId: string, event: unknown) {
    try {
      // Per-channel notif preference travels at the push body level; without
      // it UserDO would fall back to "all" and thread replies would bypass the
      // per-channel mute entirely (message.new carries it via the broadcaster).
      const prefRows = await this.db
        .select({ notifPref: schema.memberState.notifPref })
        .from(schema.memberState)
        .where(eq(schema.memberState.userId, userId))
        .limit(1);
      const id = this.env.USER_DO.idFromName(userDoName(userId));
      await this.env.USER_DO.get(id).push({
        channelId: this.channelId,
        events: [event],
        notifPref: (prefRows[0]?.notifPref as "all" | "mention" | "none" | undefined) ?? undefined,
      });
    } catch {}
  }

  async fetch(_request: Request): Promise<Response> {
    return new Response("not found", { status: 404 });
  }
}
