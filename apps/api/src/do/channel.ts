import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { eq } from "drizzle-orm";
import migrations from "../../migrations/channel-do/migrations";
import * as schema from "../db/schema-channel-do.ts";

export class ChannelDO extends DurableObject<Env> {
  db: ReturnType<typeof drizzle>;
  subscribers = new Map<string, { userId: string }>();

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

  async fetch(_request: Request): Promise<Response> {
    return new Response("not found", { status: 404 });
  }
}
