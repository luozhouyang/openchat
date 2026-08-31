import { Hono, type Context } from "hono";
import { z } from "zod";
import { userDoName } from "protocol";
import type { SessionContext } from "../../auth/session.ts";
import { requireSession } from "../../auth/session.ts";

type StatusContext = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

export const statusV1 = new Hono<{ Bindings: Env }>();

const StatusValue = z.enum(["online", "away", "dnd", "offline"]);

const PutStatusBody = z.object({
  status: StatusValue,
  dnd_end_time: z.number().int().positive().nullable().optional(),
});

const StatusIdsBody = z.object({
  user_ids: z.array(z.string().min(1).max(256)).min(1).max(200),
});

function targetUserId(c: StatusContext, raw: string): string {
  return raw === "me" ? c.get("session")!.user.id : raw;
}

function userDoStub(env: Env, userId: string) {
  return env.USER_DO.get(env.USER_DO.idFromName(userDoName(userId)));
}

statusV1.get("/users/:user_id/status", requireSession, async (c) => {
  const userId = targetUserId(c, c.req.param("user_id"));
  const s = await userDoStub(c.env, userId).getStatus(userId);
  return c.json({
    user_id: s.userId,
    status: s.status,
    manual: s.manual,
    last_activity_at: s.lastActivityAt,
    dnd_end_time: s.dndEndTime,
  });
});

statusV1.put("/users/:user_id/status", requireSession, async (c) => {
  const sessionId = c.get("session")!.user.id;
  const userId = targetUserId(c, c.req.param("user_id"));
  if (userId !== sessionId) return c.json({ error: "forbidden" }, 403);
  const body = PutStatusBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 422);
  await userDoStub(c.env, userId).setStatus(userId, {
    status: body.data.status,
    manual: true,
    dndEndTime: body.data.dnd_end_time ?? null,
  });
  return c.json({ ok: true });
});

statusV1.post("/users/status/ids", requireSession, async (c) => {
  const body = StatusIdsBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const statuses: Record<string, "online" | "away" | "offline"> = {};
  for (const uid of body.data.user_ids) {
    const stub = userDoStub(c.env, uid);
    try {
      const { status } = await stub.presenceStatus();
      statuses[uid] = status;
    } catch {
      const s = await stub.getStatus(uid);
      statuses[uid] = s.status === "dnd" ? "online" : (s.status as "online" | "away" | "offline");
    }
  }
  return c.json({ statuses });
});
