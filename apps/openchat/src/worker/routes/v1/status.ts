import { Hono, type Context } from "hono";
import { eq, inArray } from "drizzle-orm";
import { userDoName, type UserStatus } from "protocol";
import { PutStatusInput, StatusIdsInput, StatusOutput, StatusesOutput } from "protocol";
import type { SessionContext } from "@worker/auth/session";
import { requireSession } from "@worker/auth/session";
import { zodValidator } from "@worker/lib/validation";
import { apiError } from "@worker/lib/errors";
import { chunkItems } from "@worker/lib/chunks";
import { getDb } from "@worker/db/client";
import * as schemaD1 from "@worker/db/schema-d1";

type StatusCtx = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

export const statusV1 = new Hono<{ Bindings: Env }>();

function targetUserId(c: StatusCtx, raw: string): string {
  return raw === "me" ? c.get("session")!.user.id : raw;
}

function userDoStub(env: Env, userId: string) {
  return env.USER_DO.get(env.USER_DO.idFromName(userDoName(userId)));
}

statusV1.get("/users/:userId/status", requireSession, async (c) => {
  const userId = targetUserId(c, c.req.param("userId"));
  // Reads hit the shared D1 `user_status` directly (no DO wake-up): the row
  // holds the effective status computed by the owning User DO.
  const rows = await getDb(c.env.DB)
    .select()
    .from(schemaD1.userStatus)
    .where(eq(schemaD1.userStatus.userId, userId))
    .limit(1);
  const row = rows[0];
  const out: StatusOutput = {
    userId,
    status: (row?.status as UserStatus) ?? "offline",
    manual: row?.manual ?? false,
    lastActivityAt: row?.lastActivityAt ?? null,
    dndEndTime: row?.dndEndTime ?? null,
  };
  return c.json(out);
});

statusV1.put(
  "/users/:userId/status",
  requireSession,
  zodValidator("json", PutStatusInput),
  async (c) => {
    const sessionId = c.get("session")!.user.id;
    const userId = targetUserId(c, c.req.param("userId"));
    if (userId !== sessionId) {
      throw apiError("forbidden", "forbidden", 403);
    }
    const body = c.req.valid("json");
    await userDoStub(c.env, userId).setStatus(userId, {
      status: body.status,
      manual: true,
      dndEndTime: body.dndEndTime ?? null,
    });
    return c.json({ ok: true });
  },
);

statusV1.post(
  "/users/status/ids",
  requireSession,
  zodValidator("json", StatusIdsInput),
  async (c) => {
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);
    const rows: Array<typeof schemaD1.userStatus.$inferSelect> = [];
    for (const chunk of chunkItems(body.userIds)) {
      rows.push(
        ...(await db
          .select()
          .from(schemaD1.userStatus)
          .where(inArray(schemaD1.userStatus.userId, chunk))),
      );
    }
    const byId = new Map(rows.map((r) => [r.userId, r]));
    const statuses: Record<string, string> = {};
    for (const uid of body.userIds) {
      const row = byId.get(uid);
      if (!row) {
        statuses[uid] = "offline";
      } else {
        // Presence indicators only know online/away/offline: a manual dnd user
        // is still connected, so surface them as online (matches the old path).
        statuses[uid] = row.status === "dnd" ? "online" : (row.status as string);
      }
    }
    const out: StatusesOutput = { statuses };
    return c.json(out);
  },
);
