import { Hono } from "hono";
import {
  CreateTeamInput,
  CreateTeamOutput,
  PatchTeamInput,
  JoinTeamInput,
  MyTeamsOutput,
  TeamOutput,
  type TeamType,
} from "protocol";
import { requireSession } from "../../auth/session.ts";
import { requireTeamRole } from "../../auth/guards.ts";
import { getDb } from "../../db/client.ts";
import { getTeam, listTeamsForUser, getTeamMember } from "../../db/repos/teams.ts";
import { createTeam, joinTeam, leaveTeam, updateTeam } from "../../services/team.service.ts";
import { zodValidator } from "../../lib/validation.ts";
import { apiError } from "../../lib/errors.ts";
import { syncUserChannels } from "../../user-do-sync.ts";

export const teamsV1 = new Hono<{ Bindings: Env }>();

teamsV1.post("/teams", requireSession, zodValidator("json", CreateTeamInput), async (c) => {
  const body = c.req.valid("json");
  const db = getDb(c.env.DB);
  const creatorId = c.get("session")!.user.id;
  const { id: teamId, inviteCode } = await createTeam(db, {
    name: body.name,
    displayName: body.displayName,
    type: body.type,
    description: body.description,
    creatorId,
  });
  // Refresh the creator's User DO channel list (they just gained a team) and
  // notify their devices.
  await syncUserChannels(c.env, creatorId);
  const out: CreateTeamOutput = inviteCode ? { id: teamId, inviteCode } : { id: teamId };
  return c.json(out, 201);
});

teamsV1.get("/users/me/teams", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await listTeamsForUser(db, c.get("session")!.user.id);
  const out: MyTeamsOutput = {
    teams: rows.map((r) => ({
      id: r.team.id,
      name: r.team.name,
      displayName: r.team.displayName,
      type: r.team.type as TeamType,
      roles: r.roles,
      archivedAt: r.team.archivedAt,
    })),
  };
  return c.json(out);
});

teamsV1.get("/teams/:teamId", requireSession, requireTeamRole("admin"), async (c) => {
  const db = getDb(c.env.DB);
  const teamId = c.req.param("teamId");
  const team = await getTeam(db, teamId);
  if (!team) throw apiError("not found", "not found", 404);
  const member = await getTeamMember(db, teamId, c.get("session")!.user.id);
  const out: TeamOutput = {
    team: {
      id: team.id,
      name: team.name,
      displayName: team.displayName,
      type: team.type as TeamType,
      roles: member?.roles ?? "team_user",
      archivedAt: team.archivedAt,
    },
  };
  return c.json(out);
});

teamsV1.put(
  "/teams/:teamId/patch",
  requireSession,
  requireTeamRole("admin"),
  zodValidator("json", PatchTeamInput),
  async (c) => {
    const body = c.req.valid("json");
    const patch: { displayName?: string; description?: string; archived?: boolean } = {};
    if (body.displayName !== undefined) patch.displayName = body.displayName;
    if (body.description !== undefined) patch.description = body.description;
    if (body.archived !== undefined) patch.archived = body.archived;
    if (Object.keys(patch).length === 0) throw apiError("invalid", "invalid", 422);
    const db = getDb(c.env.DB);
    await updateTeam(db, { teamId: c.req.param("teamId"), patch });
    return c.json({ ok: true });
  },
);

teamsV1.post(
  "/teams/:teamId/members",
  requireSession,
  zodValidator("json", JoinTeamInput),
  async (c) => {
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);
    await joinTeam(db, {
      teamId: c.req.param("teamId"),
      userId: c.get("session")!.user.id,
      inviteCode: body.inviteCode,
    });
    // Joining a team changes the user's channel set: refresh the User DO
    // subscriptions and notify devices (previously missed — the new team's
    // channels never reached the User DO until the next workspaces call).
    await syncUserChannels(c.env, c.get("session")!.user.id);
    return c.json({ ok: true });
  },
);

teamsV1.delete(
  "/teams/:teamId/members/:userId",
  requireSession,
  requireTeamRole("member"),
  async (c) => {
    const userId = c.req.param("userId");
    const me = c.get("session")!.user.id;
    if (userId !== me) throw apiError("forbidden", "forbidden", 403);
    const db = getDb(c.env.DB);
    await leaveTeam(db, { teamId: c.req.param("teamId"), userId });
    await syncUserChannels(c.env, userId);
    return c.json({ ok: true });
  },
);
