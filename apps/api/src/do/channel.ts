import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { and, desc, eq, gt, lt } from "drizzle-orm";
import { newId } from "protocol";
import migrations from "../../migrations/channel-do/migrations";
import * as schema from "../db/schema-channel-do.ts";
import { createBroadcaster } from "./broadcast.ts";

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

  async postMessage(
    senderUserId: string,
    body: { content: string; parentId?: string; clientToken: string },
  ): Promise<
    | { messageId: string; seq: number; deduplicated?: boolean }
    | { error: string; status: 403 | 422 | 429 }
  > {
    if (!body.content || body.content.length > 16384) return { error: "invalid", status: 422 };
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
    const id = newId();
    const result = await this.db
      .insert(schema.messages)
      .values({
        id,
        userId: senderUserId,
        parentId: body.parentId ?? null,
        type: "text",
        content: body.content,
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
    await this.broadcast({ type: "message.new", message: this.rowToMessage(msg) });
    return { messageId: msg.id, seq: msg.seq };
  }

  async history(params: {
    limit?: number;
    beforeSeq?: number;
    afterSeq?: number;
  }): Promise<{ messages: HistoryMessage[]; oldestSeq: number | null }> {
    const limit = Math.min(params.limit ?? 30, 500);
    const rows = await this.db
      .select()
      .from(schema.messages)
      .where(
        and(
          ...(params.beforeSeq !== undefined ? [lt(schema.messages.seq, params.beforeSeq)] : []),
          ...(params.afterSeq !== undefined ? [gt(schema.messages.seq, params.afterSeq)] : []),
        ),
      )
      .orderBy(desc(schema.messages.seq))
      .limit(limit);
    const result = rows.map((r) => this.rowToMessage(r));
    return { messages: result, oldestSeq: result.length ? result[result.length - 1].seq : null };
  }

  async meta(): Promise<Record<string, string>> {
    const rows = await this.db.select().from(schema.meta);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
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
      content: r.content,
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

  async fetch(_request: Request): Promise<Response> {
    return new Response("not found", { status: 404 });
  }
}
