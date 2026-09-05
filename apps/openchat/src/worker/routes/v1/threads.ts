import { Hono, type Context } from "hono";
import { channelDoName } from "protocol";
import {
  ThreadReadInput,
  ThreadFollowInput,
  ThreadQuery,
  type ThreadInfo,
  type ThreadOutput,
  type MyThreadsOutput,
} from "protocol";
import type { SessionContext } from "@worker/auth/session";
import { requireSession } from "@worker/auth/session";
import { getDb } from "@worker/db/client";
import { getChannel, getChannelMember } from "@worker/db/repos/channels";
import { getTeam, getTeamMember, listChannelIdsForUserInTeam } from "@worker/db/repos/teams";
import { apiError } from "@worker/lib/errors";
import { zodValidator } from "@worker/lib/validation";

type ThreadsCtx = Context<{ Bindings: Env; Variables: { session: SessionContext } }>;

export const threadsV1 = new Hono<{ Bindings: Env }>();

function channelStub(env: Env, channelId: string) {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
}

async function requireChannelMember(c: ThreadsCtx, channelId: string) {
  const db = getDb(c.env.DB);
  const channel = await getChannel(db, channelId);
  if (!channel) {
    throw apiError("not found", "channel not found", 404);
  }
  const member = await getChannelMember(db, channelId, c.get("session")!.user.id);
  if (!member) {
    throw apiError("forbidden", "forbidden", 403);
  }
}

threadsV1.get(
  "/posts/:postId/thread",
  requireSession,
  zodValidator("query", ThreadQuery),
  async (c) => {
    const body = c.req.valid("query");
    await requireChannelMember(c, body.channelId);
    const res = await channelStub(c.env, body.channelId).getThread(c.req.param("postId"));
    if ("error" in res) {
      throw apiError(res.error, res.error, res.status);
    }
    return c.json(res as ThreadOutput);
  },
);
threadsV1.get("/users/:userId/teams/:teamId/threads", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const me = c.get("session")!.user.id;
  const target = c.req.param("userId") === "me" ? me : c.req.param("userId");
  if (target !== me) {
    throw apiError("forbidden", "forbidden", 403);
  }
  const teamId = c.req.param("teamId");
  const team = await getTeam(db, teamId);
  if (!team) {
    throw apiError("not found", "team not found", 404);
  }
  const teamMember = await getTeamMember(db, teamId, target);
  if (!teamMember) {
    throw apiError("forbidden", "forbidden", 403);
  }
  const channelIds = await listChannelIdsForUserInTeam(db, teamId, target);
  const threads: ThreadInfo[] = [];
  for (const channelId of channelIds) {
    const res = await channelStub(c.env, channelId).threadsForUser(target);
    if ("error" in res) {
      continue;
    }
    for (const t of res.threads) {
      threads.push({ ...t, channelId });
    }
  }
  const out: MyThreadsOutput = { threads };
  return c.json(out);
});
threadsV1.post(
  "/posts/:postId/thread/read",
  requireSession,
  zodValidator("json", ThreadReadInput),
  async (c) => {
    const body = c.req.valid("json");
    await requireChannelMember(c, body.channelId);
    const res = await channelStub(c.env, body.channelId).threadMarkRead(c.get("session")!.user.id, {
      postId: c.req.param("postId"),
    });
    if ("error" in res) {
      throw apiError(res.error, res.error, res.status);
    }
    return c.json({ ok: true });
  },
);
threadsV1.post(
  "/posts/:postId/following",
  requireSession,
  zodValidator("json", ThreadFollowInput),
  async (c) => {
    const body = c.req.valid("json");
    await requireChannelMember(c, body.channelId);
    const res = await channelStub(c.env, body.channelId).threadFollow(c.get("session")!.user.id, {
      postId: c.req.param("postId"),
      following: body.state,
    });
    if ("error" in res) {
      throw apiError(res.error, res.error, res.status);
    }
    return c.json({ ok: true });
  },
);
