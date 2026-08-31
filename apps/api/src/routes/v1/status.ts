import { Hono, type Context } from "hono";
import { userDoName, type UserStatus } from "protocol";
import { PutStatusInput, StatusIdsInput, StatusOutput, StatusesOutput } from "protocol";
import type { SessionContext } from "../../auth/session.ts";
import { requireSession } from "../../auth/session.ts";
import { zodValidator } from "../../lib/validation.ts";
import { apiError } from "../../lib/errors.ts";

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
  const s = await userDoStub(c.env, userId).getStatus(userId);
  const out: StatusOutput = {
    userId: s.userId,
    status: s.status as UserStatus,
    manual: s.manual,
    lastActivityAt: s.lastActivityAt,
    dndEndTime: s.dndEndTime,
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
    if (userId !== sessionId) throw apiError("forbidden", "forbidden", 403);
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
    const statuses: Record<string, "online" | "away" | "offline"> = {};
    for (const uid of body.userIds) {
      const stub = userDoStub(c.env, uid);
      try {
        const { status } = await stub.presenceStatus();
        statuses[uid] = status;
      } catch {
        const s = await stub.getStatus(uid);
        statuses[uid] = s.status === "dnd" ? "online" : (s.status as "online" | "away" | "offline");
      }
    }
    const out: StatusesOutput = { statuses };
    return c.json(out);
  },
);
