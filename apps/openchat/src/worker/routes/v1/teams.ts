import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  CreateTeamInput,
  CreateTeamOutput,
  PatchTeamInput,
  JoinTeamInput,
  JoinByInviteInput,
  MyTeamsOutput,
  TeamOutput,
  teamUpdatedEvent,
  teamMemberAddedEvent,
  teamMemberRemovedEvent,
  type JoinByInviteOutput,
  type TeamMembersOutput,
  type TeamType,
  type TeamUpdatePayload,
} from "protocol";
import { requireSession } from "@worker/auth/session";
import { requireTeamRole, requirePermission } from "@worker/auth/guards";
import { PERMISSIONS } from "@worker/auth/rbac";
import { getDb } from "@worker/db/client";
import { teamMembers } from "@worker/db/schema-d1";
import { getTeam, listTeamsForUser, getTeamMember } from "@worker/db/repos/teams";
import {
  createTeam,
  joinTeam,
  leaveTeam,
  updateTeam,
  joinByInvite,
} from "@worker/services/team.service";
import { zodValidator } from "@worker/lib/validation";
import { apiError } from "@worker/lib/errors";
import { syncUserChannels } from "@worker/user-do-sync";
import { createTeamBroadcaster } from "@worker/structure-broadcast";
import type { Db } from "@worker/db/types";

export const teamsV1 = new Hono<{ Bindings: Env }>();

async function teamPayload(db: Db, teamId: string): Promise<TeamUpdatePayload | null> {
  const team = await getTeam(db, teamId);
  if (!team) {
    return null;
  }
  return {
    id: team.id,
    name: team.name,
    displayName: team.displayName,
    type: team.type as TeamUpdatePayload["type"],
    archivedAt: team.archivedAt,
  };
}

teamsV1.post(
  "/teams",
  requireSession,
  requirePermission(PERMISSIONS.CREATE_TEAM),
  zodValidator("json", CreateTeamInput),
  async (c) => {
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
    await syncUserChannels(c.env, creatorId);
    const member = await getTeamMember(db, teamId, creatorId);
    await createTeamBroadcaster(c.env, teamId).broadcast(
      teamMemberAddedEvent.parse({
        type: "team.member_added",
        team: { ...(await teamPayload(db, teamId))!, roles: member?.roles ?? "team_admin" },
        userId: creatorId,
      }),
    );
    const out: CreateTeamOutput = inviteCode ? { id: teamId, inviteCode } : { id: teamId };
    return c.json(out, 201);
  },
);

teamsV1.post("/teams/join", requireSession, zodValidator("json", JoinByInviteInput), async (c) => {
  const body = c.req.valid("json");
  const db = getDb(c.env.DB);
  const userId = c.get("session")!.user.id;
  const teamId = await joinByInvite(db, { inviteCode: body.inviteCode, userId });
  await syncUserChannels(c.env, userId);
  const member = await getTeamMember(db, teamId, userId);
  await createTeamBroadcaster(c.env, teamId).broadcast(
    teamMemberAddedEvent.parse({
      type: "team.member_added",
      team: { ...(await teamPayload(db, teamId))!, roles: member?.roles ?? "team_user" },
      userId,
    }),
  );
  return c.json({ teamId } satisfies JoinByInviteOutput, 201);
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
  if (!team) {
    throw apiError("not found", "not found", 404);
  }
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

teamsV1.get("/teams/:teamId/members", requireSession, requireTeamRole("admin"), async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db
    .select({ userId: teamMembers.userId, roles: teamMembers.roles })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, c.req.param("teamId")));
  const out: TeamMembersOutput = { members: rows };
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
    if (body.displayName !== undefined) {
      patch.displayName = body.displayName;
    }
    if (body.description !== undefined) {
      patch.description = body.description;
    }
    if (body.archived !== undefined) {
      patch.archived = body.archived;
    }
    if (Object.keys(patch).length === 0) {
      throw apiError("invalid", "invalid", 422);
    }
    const db = getDb(c.env.DB);
    const teamId = c.req.param("teamId");
    await updateTeam(db, { teamId, patch });
    await syncUserChannels(c.env, c.get("session")!.user.id);
    const payload = await teamPayload(db, teamId);
    if (payload) {
      await createTeamBroadcaster(c.env, teamId).broadcast(
        teamUpdatedEvent.parse({ type: "team.updated", team: payload }),
      );
    }
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
    const teamId = c.req.param("teamId");
    const userId = c.get("session")!.user.id;
    const alreadyMember = (await getTeamMember(db, teamId, userId)) !== null;
    await joinTeam(db, { teamId, userId, inviteCode: body.inviteCode });
    // Joining a team changes the user's workspace view: refresh the User DO
    // subscriptions and notify devices (previously missed — the new team's
    // channels never reached the User DO until the next workspaces call).
    await syncUserChannels(c.env, userId);
    if (!alreadyMember) {
      const member = await getTeamMember(db, teamId, userId);
      await createTeamBroadcaster(c.env, teamId).broadcast(
        teamMemberAddedEvent.parse({
          type: "team.member_added",
          team: { ...(await teamPayload(db, teamId))!, roles: member?.roles ?? "team_user" },
          userId,
        }),
      );
    }
    return c.json({ ok: true });
  },
);

teamsV1.delete(
  "/teams/:teamId/members/:userId",
  requireSession,
  requireTeamRole("member"),
  async (c) => {
    const rawUserId = c.req.param("userId");
    const me = c.get("session")!.user.id;
    const userId = rawUserId === "me" ? me : rawUserId;
    const db = getDb(c.env.DB);
    if (userId !== me) {
      const member = await getTeamMember(db, c.req.param("teamId"), me);
      if (!member || !member.roles.split(" ").includes("team_admin")) {
        throw apiError("forbidden", "forbidden", 403);
      }
    }
    const teamId = c.req.param("teamId");
    const member = await getTeamMember(db, teamId, userId);
    await leaveTeam(db, { teamId, userId });
    await syncUserChannels(c.env, userId);
    if (member) {
      await createTeamBroadcaster(c.env, teamId).broadcast(
        teamMemberRemovedEvent.parse({ type: "team.member_removed", teamId, userId }),
        [userId],
      );
    }
    return c.json({ ok: true });
  },
);
