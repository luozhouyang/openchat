import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { requireSession } from "../../auth/session.ts";
import { getDb } from "../../db/client.ts";
import { users } from "../../db/schema-d1.ts";
import { listTeamsForUser } from "../../db/repos/teams.ts";
import { listChannelsForTeam, listChannelsForUser } from "../../db/repos/channels.ts";
import { syncUserChannels } from "../../user-do-sync.ts";

export const usersV1 = new Hono<{ Bindings: Env }>();

usersV1.get("/users/me", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const session = c.get("session")!;
  const rows = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  const row = rows[0];
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({
    user: {
      id: row.id,
      email: row.email,
      username: row.username ?? null,
      nickname: row.nickname ?? null,
      avatar_url: row.avatarUrl ?? row.image ?? null,
      created_at: row.createdAt.toISOString(),
    },
  });
});

usersV1.get("/users/me/workspaces", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const userId = c.get("session")!.user.id;
  const teamsRows = await listTeamsForUser(db, userId);
  const myChannels = new Set((await listChannelsForUser(db, userId)).map((r) => r.channel.id));
  const teams = [];
  for (const t of teamsRows) {
    const chs = await listChannelsForTeam(db, t.team.id);
    teams.push({
      id: t.team.id,
      name: t.team.name,
      displayName: t.team.displayName,
      type: t.team.type,
      roles: t.roles,
      archivedAt: t.team.archivedAt,
      channels: chs.map((ch) => ({
        id: ch.id,
        teamId: ch.teamId,
        name: ch.name,
        displayName: ch.displayName,
        type: ch.type,
        member: myChannels.has(ch.id),
        archivedAt: ch.archivedAt,
      })),
    });
  }
  await syncUserChannels(c.env, userId);
  return c.json({ teams });
});
