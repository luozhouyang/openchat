import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { newId, CreateChannelInput, OpenDmInput, OpenGmInput } from "protocol";
import { requireSession } from "../auth/session.ts";
import { requireTeamRole, requireChannelRole } from "../auth/guards.ts";
import { getDb } from "../db/client.ts";
import { channels, channelMembers } from "../db/schema-d1.ts";
import {
  createChannel,
  getChannel,
  getChannelByDedupKey,
  listChannelsForTeam,
  addChannelMember,
  removeChannelMember,
  getChannelMember,
  listChannelMemberIds,
} from "../db/repos/channels.ts";
import { getTeamMember } from "../db/repos/teams.ts";
import { syncUserChannels } from "../user-do-sync.ts";

export const channelsRoutes = new Hono<{ Bindings: Env }>();

channelsRoutes.post(
  "/teams/:teamId/channels",
  requireSession,
  requireTeamRole("member"),
  async (c) => {
    const body = CreateChannelInput.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "invalid" }, 422);
    const db = getDb(c.env.DB);
    try {
      const ch = await createChannel(db, {
        id: newId(),
        teamId: c.req.param("teamId"),
        name: body.data.name ?? null,
        displayName: body.data.displayName,
        type: body.data.type,
        dedupKey: null,
        creatorId: c.get("session")!.user.id,
      });
      return c.json({ id: ch?.id }, 201);
    } catch {
      return c.json({ error: "name taken" }, 409);
    }
  },
);

channelsRoutes.get(
  "/teams/:teamId/channels",
  requireSession,
  requireTeamRole("member"),
  async (c) => {
    const db = getDb(c.env.DB);
    const teamId = c.req.param("teamId");
    const userId = c.get("session")!.user.id;
    const all = await listChannelsForTeam(db, teamId);
    const mine = new Set(
      (await db.select().from(channelMembers).where(eq(channelMembers.userId, userId))).map(
        (r) => r.channelId,
      ),
    );
    return c.json({
      channels: all.map((ch) => ({
        id: ch.id,
        teamId: ch.teamId,
        name: ch.name,
        displayName: ch.displayName,
        type: ch.type,
        member: mine.has(ch.id),
        archivedAt: ch.archivedAt,
      })),
    });
  },
);

channelsRoutes.post("/channels/:channelId/join", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const ch = await getChannel(db, c.req.param("channelId"));
  if (!ch) return c.json({ error: "not found" }, 404);
  if (ch.type !== "public") return c.json({ error: "forbidden" }, 403);
  const userId = c.get("session")!.user.id;
  if (ch.teamId && !(await getTeamMember(db, ch.teamId, userId)))
    return c.json({ error: "forbidden" }, 403);
  if (!(await getChannelMember(db, ch.id, userId))) {
    await addChannelMember(db, { channelId: ch.id, userId, role: "member" });
    await syncUserChannels(c.env, userId);
  }
  return c.json({ ok: true });
});

channelsRoutes.post(
  "/channels/:channelId/leave",
  requireSession,
  requireChannelRole("member"),
  async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get("session")!.user.id;
    await removeChannelMember(db, c.req.param("channelId"), userId);
    await syncUserChannels(c.env, userId);
    return c.json({ ok: true });
  },
);

channelsRoutes.get(
  "/channels/:channelId",
  requireSession,
  requireChannelRole("member"),
  async (c) => {
    const db = getDb(c.env.DB);
    const ch = (await getChannel(db, c.req.param("channelId")))!;
    const memberIds = await listChannelMemberIds(db, ch.id);
    return c.json({
      id: ch.id,
      displayName: ch.displayName,
      type: ch.type,
      memberCount: memberIds.length,
      archivedAt: ch.archivedAt,
    });
  },
);

channelsRoutes.post(
  "/channels/:channelId/archive",
  requireSession,
  requireChannelRole("admin"),
  async (c) => {
    const db = getDb(c.env.DB);
    await db
      .update(channels)
      .set({ archivedAt: Date.now() })
      .where(eq(channels.id, c.req.param("channelId")));
    return c.json({ ok: true });
  },
);

async function dedupKeyFor(kind: "dm" | "gm", ids: string[]): Promise<string> {
  const sorted = [...ids].sort();
  const data = new TextEncoder().encode(`${kind}:${sorted.join(",")}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${kind}:${hex}`;
}

channelsRoutes.post("/channels/dm", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const me = c.get("session")!.user.id;
  const body = OpenDmInput.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const { withUserId } = body.data;
  if (withUserId === me) return c.json({ error: "invalid" }, 422);
  const key = await dedupKeyFor("dm", [me, withUserId]);
  const existing = await getChannelByDedupKey(db, key);
  if (existing) return c.json({ id: existing.id, existing: true });
  const ch = await createChannel(db, {
    id: newId(),
    teamId: null,
    name: null,
    displayName: "dm",
    type: "dm",
    dedupKey: key,
    creatorId: null,
  });
  await addChannelMember(db, { channelId: ch!.id, userId: me, role: "member" });
  await addChannelMember(db, { channelId: ch!.id, userId: withUserId, role: "member" });
  await syncUserChannels(c.env, me);
  await syncUserChannels(c.env, withUserId);
  return c.json({ id: ch!.id, existing: false }, 201);
});

channelsRoutes.post("/channels/gm", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const me = c.get("session")!.user.id;
  const body = OpenGmInput.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const ids = [...new Set([me, ...body.data.userIds])];
  const key = await dedupKeyFor("gm", ids);
  const existing = await getChannelByDedupKey(db, key);
  if (existing) return c.json({ id: existing.id, existing: true });
  const ch = await createChannel(db, {
    id: newId(),
    teamId: null,
    name: null,
    displayName: "gm",
    type: "gm",
    dedupKey: key,
    creatorId: null,
  });
  for (const userId of ids) {
    await addChannelMember(db, { channelId: ch!.id, userId, role: "member" });
    await syncUserChannels(c.env, userId);
  }
  return c.json({ id: ch!.id, existing: false }, 201);
});
