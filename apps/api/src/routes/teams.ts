import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { id, CreateTeamInput, JoinTeamInput } from "protocol";
import { requireSession } from "../auth/session.ts";
import { requireTeamRole } from "../auth/guards.ts";
import { getDb } from "../db/client.ts";
import { teams } from "../db/schema-d1.ts";
import {
  createTeam,
  getTeam,
  listTeamsForUser,
  addTeamMember,
  removeTeamMember,
  countTeamAdmins,
  getTeamMember,
} from "../db/repos/teams.ts";
import { syncUserChannels } from "../user-do-sync.ts";

function inviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const teamsRoutes = new Hono<{ Bindings: Env }>();

teamsRoutes.post("/teams", requireSession, async (c) => {
  const body = CreateTeamInput.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  const teamId = id("team");
  try {
    await createTeam(db, {
      id: teamId,
      name: body.data.name,
      displayName: body.data.displayName,
      type: body.data.type,
      inviteCode: body.data.type === "invite" ? inviteCode() : null,
      creatorId: c.get("session")!.user.id,
    });
  } catch {
    return c.json({ error: "name taken" }, 409);
  }
  return c.json({ id: teamId }, 201);
});

teamsRoutes.get("/teams", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await listTeamsForUser(db, c.get("session")!.user.id);
  return c.json({
    teams: rows.map((r) => ({
      id: r.team.id,
      name: r.team.name,
      displayName: r.team.displayName,
      type: r.team.type,
      roles: r.roles,
      archivedAt: r.team.archivedAt,
    })),
  });
});

teamsRoutes.get("/teams/:teamId", requireSession, requireTeamRole("admin"), async (c) => {
  const db = getDb(c.env.DB);
  const team = await getTeam(db, c.req.param("teamId"));
  if (!team) return c.json({ error: "not found" }, 404);
  return c.json({ team });
});

teamsRoutes.post("/teams/:teamId/join", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const team = await getTeam(db, c.req.param("teamId"));
  if (!team) return c.json({ error: "not found" }, 404);
  if (team.type === "invite") {
    const body = JoinTeamInput.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success || body.data.inviteCode !== team.inviteCode)
      return c.json({ error: "forbidden" }, 403);
  }
  const userId = c.get("session")!.user.id;
  if (await getTeamMember(db, team.id, userId)) return c.json({ ok: true });
  await addTeamMember(db, { teamId: team.id, userId, roles: "team_user" });
  return c.json({ ok: true });
});

teamsRoutes.post("/teams/:teamId/leave", requireSession, requireTeamRole("member"), async (c) => {
  const db = getDb(c.env.DB);
  const teamId = c.req.param("teamId");
  const userId = c.get("session")!.user.id;
  const member = await getTeamMember(db, teamId, userId);
  if (member?.roles.split(" ").includes("team_admin") && (await countTeamAdmins(db, teamId)) <= 1) {
    return c.json({ error: "transfer admin first" }, 409);
  }
  await removeTeamMember(db, teamId, userId);
  await syncUserChannels(c.env, userId);
  return c.json({ ok: true });
});

teamsRoutes.patch("/teams/:teamId", requireSession, requireTeamRole("admin"), async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== "object") return c.json({ error: "invalid" }, 422);
  const body = raw as { displayName?: unknown; archived?: unknown };
  const values: Partial<typeof teams.$inferInsert> = {};
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== "string" || body.displayName.length === 0) {
      return c.json({ error: "invalid" }, 422);
    }
    values.displayName = body.displayName;
  }
  if (body.archived !== undefined) {
    if (typeof body.archived !== "boolean") return c.json({ error: "invalid" }, 422);
    values.archivedAt = body.archived ? Date.now() : null;
  }
  if (Object.keys(values).length === 0) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  await db
    .update(teams)
    .set(values)
    .where(eq(teams.id, c.req.param("teamId")));
  return c.json({ ok: true });
});
