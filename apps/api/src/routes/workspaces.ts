import { Hono } from "hono";
import { requireSession } from "../auth/session.ts";
import { getDb } from "../db/client.ts";
import { listTeamsForUser } from "../db/repos/teams.ts";
import { listChannelsForTeam, listChannelsForUser } from "../db/repos/channels.ts";
import { syncUserChannels } from "../user-do-sync.ts";

export const workspacesRoutes = new Hono<{ Bindings: Env }>();

workspacesRoutes.get("/me/workspaces", requireSession, async (c) => {
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
      role: t.role,
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
