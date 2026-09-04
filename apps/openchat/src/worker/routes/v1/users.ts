import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { WorkspaceResponse, type ChannelSummary, type ChannelType, type TeamType } from "protocol";
import { requireSession } from "../../auth/session.ts";
import { getDb } from "../../db/client.ts";
import { users } from "../../db/schema-d1.ts";
import { listTeamsForUser } from "../../db/repos/teams.ts";
import { listChannelsForTeam, listChannelsForUser } from "../../db/repos/channels.ts";
import { syncUserChannels } from "../../user-do-sync.ts";
import { apiError } from "../../lib/errors.ts";

export const usersV1 = new Hono<{ Bindings: Env }>();

usersV1.get("/users/me", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const session = c.get("session")!;
  const rows = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  const row = rows[0];
  if (!row) throw apiError("not_found", "not found", 404);
  return c.json({
    user: {
      id: row.id,
      email: row.email,
      username: row.username ?? null,
      nickname: row.nickname ?? null,
      avatarUrl: row.avatarUrl ?? row.image ?? null,
      createdAt: row.createdAt.toISOString(),
    },
  });
});

usersV1.get("/users/me/workspaces", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const userId = c.get("session")!.user.id;
  const teamsRows = await listTeamsForUser(db, userId);
  const allChannels = await listChannelsForUser(db, userId);
  const myChannels = new Set(allChannels.map((r) => r.channel.id));
  const toSummary = (
    ch: (typeof allChannels)[number]["channel"],
    member: boolean,
  ): ChannelSummary => ({
    id: ch.id,
    teamId: ch.teamId,
    name: ch.name,
    displayName: ch.displayName,
    type: ch.type as ChannelType,
    member,
    archivedAt: ch.archivedAt,
  });
  const teams = await Promise.all(
    teamsRows.map(async (t) => {
      const chs = await listChannelsForTeam(db, t.team.id);
      return {
        id: t.team.id,
        name: t.team.name,
        displayName: t.team.displayName,
        type: t.team.type as TeamType,
        roles: t.roles,
        archivedAt: t.team.archivedAt,
        channels: chs.map((ch) => toSummary(ch, myChannels.has(ch.id))),
      };
    }),
  );
  const directs = allChannels
    .filter((r) => r.channel.teamId === null)
    .map((r) => toSummary(r.channel, true));
  await syncUserChannels(c.env, userId);
  const out: WorkspaceResponse = { teams, directs };
  return c.json(out);
});
