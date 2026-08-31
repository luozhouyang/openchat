import { Hono } from "hono";
import { z } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { requireSession } from "../../auth/session.ts";
import { requireTeamRole } from "../../auth/guards.ts";
import { getDb } from "../../db/client.ts";
import { getTeam, listTeamsForUser } from "../../db/repos/teams.ts";
import { createTeam, joinTeam, leaveTeam, updateTeam } from "../../services/team.service.ts";
import { HttpError } from "../../lib/errors.ts";
import { syncUserChannels } from "../../user-do-sync.ts";

const slug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

const CreateTeamBody = z.object({
  name: slug,
  display_name: z.string().min(1).max(128),
  type: z.enum(["open", "invite"]).default("open"),
  description: z.string().max(1024).optional(),
});

const JoinTeamBody = z.object({
  invite_code: z.string().max(128).optional(),
  inviteCode: z.string().max(128).optional(),
});

const PatchTeamBody = z.object({
  display_name: z.string().min(1).max(128).optional(),
  description: z.string().max(1024).optional(),
  archived: z.boolean().optional(),
});

export const teamsV1 = new Hono<{ Bindings: Env }>();

teamsV1.post("/teams", requireSession, async (c) => {
  const body = CreateTeamBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  try {
    const { id: teamId } = await createTeam(db, {
      name: body.data.name,
      displayName: body.data.display_name,
      type: body.data.type,
      description: body.data.description,
      creatorId: c.get("session")!.user.id,
    });
    return c.json({ id: teamId }, 201);
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
});

teamsV1.get("/users/me/teams", requireSession, async (c) => {
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

teamsV1.get("/teams/:teamId", requireSession, requireTeamRole("admin"), async (c) => {
  const db = getDb(c.env.DB);
  const team = await getTeam(db, c.req.param("teamId"));
  if (!team) return c.json({ error: "not found" }, 404);
  return c.json({ team });
});

teamsV1.put("/teams/:teamId/patch", requireSession, requireTeamRole("admin"), async (c) => {
  const body = PatchTeamBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const patch: { displayName?: string; description?: string; archived?: boolean } = {};
  if (body.data.display_name !== undefined) patch.displayName = body.data.display_name;
  if (body.data.description !== undefined) patch.description = body.data.description;
  if (body.data.archived !== undefined) patch.archived = body.data.archived;
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

teamsV1.post("/teams/:teamId/members", requireSession, async (c) => {
  const body = JoinTeamBody.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  try {
    await joinTeam(db, {
      teamId: c.req.param("teamId"),
      userId: c.get("session")!.user.id,
      inviteCode: body.data.invite_code ?? body.data.inviteCode,
    });
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
  return c.json({ ok: true });
});

teamsV1.delete(
  "/teams/:teamId/members/:userId",
  requireSession,
  requireTeamRole("member"),
  async (c) => {
    const userId = c.req.param("userId");
    const me = c.get("session")!.user.id;
    if (userId !== me) return c.json({ error: "forbidden" }, 403);
    const db = getDb(c.env.DB);
    const teamId = c.req.param("teamId");
    try {
      await leaveTeam(db, { teamId, userId });
    } catch (err) {
      if (err instanceof HttpError)
        return c.json({ error: err.code }, err.status as ContentfulStatusCode);
      throw err;
    }
    await syncUserChannels(c.env, userId);
    return c.json({ ok: true });
  },
);
