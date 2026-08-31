import { Hono } from "hono";
import { z } from "zod";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { channelDoName } from "protocol";
import { requireSession } from "../../auth/session.ts";
import type { SessionContext } from "../../auth/session.ts";
import { getDb } from "../../db/client.ts";
import { getChannel, getChannelMember } from "../../db/repos/channels.ts";
import { getTeam, getTeamMember, listChannelIdsForUserInTeam } from "../../db/repos/teams.ts";

const ThreadReadBody = z.object({
  channel_id: z.string().min(1),
});

const ThreadFollowBody = z.object({
  channel_id: z.string().min(1),
  state: z.boolean(),
});

type ThreadsCtx = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

function channelStub(env: Env, channelId: string) {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
}

async function requireChannelMember(c: ThreadsCtx, channelId: string): Promise<Response | null> {
  const db = getDb(c.env.DB);
  const channel = await getChannel(db, channelId);
  if (!channel) return c.json({ error: "channel not found" }, 404);
  const member = await getChannelMember(db, channelId, c.get("session")!.user.id);
  if (!member) return c.json({ error: "forbidden" }, 403);
  return null;
}

export const threadsV1 = new Hono<{ Bindings: Env }>();

threadsV1.get("/posts/:postId/thread", requireSession, async (c) => {
  const channelId = new URL(c.req.url).searchParams.get("channel_id");
  if (!channelId) return c.json({ error: "invalid" }, 422);
  const denied = await requireChannelMember(c, channelId);
  if (denied) return denied;
  const stub = channelStub(c.env, channelId);
  const res = await stub.getThread(c.req.param("postId")!);
  if ("error" in res) return c.json({ error: res.error }, res.status as ContentfulStatusCode);
  return c.json(res);
});

threadsV1.get("/users/:userId/teams/:teamId/threads", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const me = c.get("session")!.user.id;
  const target = c.req.param("userId")!;
  const userId = target === "me" ? me : target;
  if (userId !== me) return c.json({ error: "forbidden" }, 403);
  const teamId = c.req.param("teamId")!;
  const team = await getTeam(db, teamId);
  if (!team) return c.json({ error: "team not found" }, 404);
  const teamMember = await getTeamMember(db, teamId, userId);
  if (!teamMember) return c.json({ error: "forbidden" }, 403);
  const channelIds = await listChannelIdsForUserInTeam(db, teamId, userId);
  const threads = [];
  for (const channelId of channelIds) {
    const stub = channelStub(c.env, channelId);
    const res = await stub.threadsForUser(userId);
    if ("error" in res) continue;
    for (const t of res.threads) {
      threads.push({ ...t, channel_id: channelId });
    }
  }
  return c.json({ threads });
});

threadsV1.post("/posts/:postId/thread/read", requireSession, async (c) => {
  const body = ThreadReadBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const denied = await requireChannelMember(c, body.data.channel_id);
  if (denied) return denied;
  const stub = channelStub(c.env, body.data.channel_id);
  const res = await stub.threadMarkRead(c.get("session")!.user.id, {
    postId: c.req.param("postId")!,
  });
  if ("error" in res) return c.json({ error: res.error }, res.status as ContentfulStatusCode);
  return c.json({ ok: true });
});

threadsV1.post("/posts/:postId/following", requireSession, async (c) => {
  const body = ThreadFollowBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const denied = await requireChannelMember(c, body.data.channel_id);
  if (denied) return denied;
  const stub = channelStub(c.env, body.data.channel_id);
  const res = await stub.threadFollow(c.get("session")!.user.id, {
    postId: c.req.param("postId")!,
    following: body.data.state,
  });
  if ("error" in res) return c.json({ error: res.error }, res.status as ContentfulStatusCode);
  return c.json({ ok: true });
});
