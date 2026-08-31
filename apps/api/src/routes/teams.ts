import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { CreateTeamInput, JoinTeamInput } from "protocol";
import { requireSession } from "../auth/session.ts";
import { requireTeamRole } from "../auth/guards.ts";
import { getDb } from "../db/client.ts";
import { getTeam, listTeamsForUser } from "../db/repos/teams.ts";
import { createTeam, joinTeam, leaveTeam, updateTeam } from "../services/team.service.ts";
import { HttpError } from "../lib/errors.ts";
import { syncUserChannels } from "../user-do-sync.ts";

export const teamsRoutes = new Hono<{ Bindings: Env }>();

teamsRoutes.post("/teams", requireSession, async (c) => {
  const body = CreateTeamInput.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  try {
    const { id: teamId } = await createTeam(db, {
      name: body.data.name,
      displayName: body.data.displayName,
      type: body.data.type,
      creatorId: c.get("session")!.user.id,
    });
    return c.json({ id: teamId }, 201);
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
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
  const body = JoinTeamInput.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  try {
    await joinTeam(db, {
      teamId: c.req.param("teamId"),
      userId: c.get("session")!.user.id,
      inviteCode: body.data.inviteCode,
    });
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
  return c.json({ ok: true });
});

teamsRoutes.post("/teams/:teamId/leave", requireSession, requireTeamRole("member"), async (c) => {
  const db = getDb(c.env.DB);
  const teamId = c.req.param("teamId");
  const userId = c.get("session")!.user.id;
  try {
    await leaveTeam(db, { teamId, userId });
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
  await syncUserChannels(c.env, userId);
  return c.json({ ok: true });
});

teamsRoutes.patch("/teams/:teamId", requireSession, requireTeamRole("admin"), async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== "object") return c.json({ error: "invalid" }, 422);
  const body = raw as { displayName?: unknown; description?: unknown; archived?: unknown };
  const patch: { displayName?: string; description?: string; archived?: boolean } = {};
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== "string" || body.displayName.length === 0) {
      return c.json({ error: "invalid" }, 422);
    }
    patch.displayName = body.displayName;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") return c.json({ error: "invalid" }, 422);
    patch.description = body.description;
  }
  if (body.archived !== undefined) {
    if (typeof body.archived !== "boolean") return c.json({ error: "invalid" }, 422);
    patch.archived = body.archived;
  }
  if (Object.keys(patch).length === 0) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  try {
    await updateTeam(db, { teamId: c.req.param("teamId"), patch });
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
  return c.json({ ok: true });
});
