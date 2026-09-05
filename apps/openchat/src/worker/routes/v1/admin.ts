import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { channelDoName } from "protocol";
import {
  RemoveMemberInput,
  EmailInput,
  PatchTeamInput,
  RolesInput,
  channelUpdatedEvent,
  channelMemberRemovedEvent,
  channelDeletedEvent,
  teamUpdatedEvent,
  teamMemberRemovedEvent,
  type AdminStatsOutput,
  type TeamMembersOutput,
  type CreateInviteOutput,
  type ChannelSummary,
  type TeamUpdatePayload,
} from "protocol";
import { requireAdmin } from "@worker/auth/admin-gate";
import type { SessionContext } from "@worker/auth/session";
import { getDb } from "@worker/db/client";
import { users, teams, channels, teamMembers, channelMembers } from "@worker/db/schema-d1";
import { listChannelsForTeam, listChannelMemberIds, getChannel } from "@worker/db/repos/channels";
import { getTeam, getTeamMember, countTeamAdmins } from "@worker/db/repos/teams";
import { removeChannelMemberFromDo, syncUserChannels } from "@worker/user-do-sync";
import {
  createChannelBroadcaster,
  createTeamBroadcaster,
  deliverStructure,
} from "@worker/structure-broadcast";
import { auditLog } from "@worker/audit";
import { zodValidator } from "@worker/lib/validation";
import { apiError } from "@worker/lib/errors";
import { updateTeam } from "@worker/services/team.service";
import { createInvite } from "@worker/services/invite.service";

export const adminV1 = new Hono<{
  Bindings: Env;
  Variables: { session: SessionContext; adminUserId: string };
}>();
adminV1.use("*", requireAdmin);

adminV1.get("/settings", async (c) => {
  return c.json({ openRegistration: true });
});
adminV1.get("/stats", async (c) => {
  const db = getDb(c.env.DB);
  const [userRows, teamRows, channelRows] = await Promise.all([
    db.select({ id: users.id }).from(users),
    db.select({ id: teams.id }).from(teams),
    db.select({ id: channels.id }).from(channels),
  ]);
  const channelIds = channelRows.map((r) => r.id).slice(0, 200);
  const truncated = channelRows.length > 200;
  let messages = 0;
  const queue = [...channelIds];
  while (queue.length > 0) {
    const batch = queue.splice(0, 8);
    const results = await Promise.all(
      batch.map(async (channelId) => {
        try {
          const stub = c.env.CHANNEL_DO.get(c.env.CHANNEL_DO.idFromName(channelDoName(channelId)));
          const res = await stub.count();
          return res.count;
        } catch {
          return 0;
        }
      }),
    );
    messages += results.reduce((a: number, b: number) => a + b, 0);
  }
  const out: AdminStatsOutput = {
    users: userRows.length,
    teams: teamRows.length,
    channels: channelRows.length,
    messages,
    truncated,
  };
  return c.json(out);
});
adminV1.post("/teams/:teamId/archive", async (c) => {
  const db = getDb(c.env.DB);
  const teamId = c.req.param("teamId");
  const now = Date.now();
  await db.update(teams).set({ archivedAt: now }).where(eq(teams.id, teamId));
  const chs = await listChannelsForTeam(db, teamId);
  for (const ch of chs) {
    await db.update(channels).set({ archivedAt: now }).where(eq(channels.id, ch.id));
  }
  const team = await getTeam(db, teamId);
  if (team) {
    await createTeamBroadcaster(c.env, teamId).broadcast(
      teamUpdatedEvent.parse({
        type: "team.updated",
        team: {
          id: team.id,
          name: team.name,
          displayName: team.displayName,
          type: team.type as TeamUpdatePayload["type"],
          archivedAt: team.archivedAt,
        },
      }),
    );
  }
  auditLog({ actor: c.get("adminUserId"), action: "team.archive", target: teamId, status: "ok" });
  return c.json({ ok: true });
});
adminV1.post("/channels/:channelId/archive", async (c) => {
  const db = getDb(c.env.DB);
  const channelId = c.req.param("channelId");
  const now = Date.now();
  await db.update(channels).set({ archivedAt: now }).where(eq(channels.id, channelId));
  const ch = await getChannel(db, channelId);
  if (ch) {
    await createChannelBroadcaster(c.env, channelId).broadcast(
      channelUpdatedEvent.parse({
        type: "channel.updated",
        channel: {
          id: ch.id,
          teamId: ch.teamId,
          name: ch.name,
          displayName: ch.displayName,
          type: ch.type as ChannelSummary["type"],
          member: true,
          archivedAt: now,
        },
      }),
    );
  }
  auditLog({
    actor: c.get("adminUserId"),
    action: "channel.archive",
    target: channelId,
    status: "ok",
  });
  return c.json({ ok: true });
});
adminV1.post("/channels/:channelId/delete", async (c) => {
  const db = getDb(c.env.DB);
  const channelId = c.req.param("channelId");
  const memberIds = await listChannelMemberIds(db, channelId);
  await db.delete(channelMembers).where(eq(channelMembers.channelId, channelId));
  await db.delete(channels).where(eq(channels.id, channelId));
  const deleted = channelDeletedEvent.parse({ type: "channel.deleted", channelId });
  await Promise.all(memberIds.map((uid) => deliverStructure(c.env, uid, deleted)));
  auditLog({
    actor: c.get("adminUserId"),
    action: "channel.delete",
    target: channelId,
    status: "ok",
  });
  return c.json({ ok: true });
});
adminV1.post(
  "/teams/:teamId/members/remove",
  zodValidator("json", RemoveMemberInput),
  async (c) => {
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);
    const teamId = c.req.param("teamId");
    const userId = body.userId;
    const chs = await listChannelsForTeam(db, teamId);
    for (const ch of chs) {
      const members = await listChannelMemberIds(db, ch.id);
      if (members.includes(userId)) {
        await db
          .delete(channelMembers)
          .where(and(eq(channelMembers.channelId, ch.id), eq(channelMembers.userId, userId)));
        await removeChannelMemberFromDo(c.env, ch.id, userId);
        const removed = channelMemberRemovedEvent.parse({
          type: "channel.member_removed",
          channelId: ch.id,
          userId,
        });
        await createChannelBroadcaster(c.env, ch.id).broadcast(removed);
        await deliverStructure(c.env, userId, removed);
      }
    }
    await db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    await syncUserChannels(c.env, userId);
    await createTeamBroadcaster(c.env, teamId).broadcast(
      teamMemberRemovedEvent.parse({ type: "team.member_removed", teamId, userId }),
      [userId],
    );
    auditLog({
      actor: c.get("adminUserId"),
      action: "team.member.remove",
      target: `${teamId}/${userId}`,
      status: "ok",
    });
    return c.json({ ok: true });
  },
);

adminV1.get("/teams/:teamId/members", async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db
    .select({ userId: teamMembers.userId, roles: teamMembers.roles })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, c.req.param("teamId")));
  const out: TeamMembersOutput = { members: rows };
  return c.json(out);
});

adminV1.put("/teams/:teamId/members/:userId/roles", zodValidator("json", RolesInput), async (c) => {
  const body = c.req.valid("json");
  const db = getDb(c.env.DB);
  const teamId = c.req.param("teamId");
  const userId = c.req.param("userId");
  const member = await getTeamMember(db, teamId, userId);
  if (!member) {
    throw apiError("not found", "not found", 404);
  }
  const roles = body.roles;
  if (
    member.roles.split(" ").includes("team_admin") &&
    !roles.includes("team_admin") &&
    (await countTeamAdmins(db, teamId)) <= 1
  ) {
    throw apiError("transfer_admin_first", "transfer admin first", 409);
  }
  await db
    .update(teamMembers)
    .set({ roles: roles.join(" ") })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  await syncUserChannels(c.env, userId);
  const team = await getTeam(db, teamId);
  if (team) {
    await createTeamBroadcaster(c.env, teamId).broadcast(
      teamUpdatedEvent.parse({
        type: "team.updated",
        team: {
          id: team.id,
          name: team.name,
          displayName: team.displayName,
          type: team.type as TeamUpdatePayload["type"],
          archivedAt: team.archivedAt,
        },
      }),
    );
  }
  return c.json({ ok: true });
});

adminV1.post("/teams/:teamId/patch", zodValidator("json", PatchTeamInput), async (c) => {
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
  const team = await getTeam(db, teamId);
  if (team) {
    await createTeamBroadcaster(c.env, teamId).broadcast(
      teamUpdatedEvent.parse({
        type: "team.updated",
        team: {
          id: team.id,
          name: team.name,
          displayName: team.displayName,
          type: team.type as TeamUpdatePayload["type"],
          archivedAt: team.archivedAt,
        },
      }),
    );
  }
  return c.json({ ok: true });
});

adminV1.post("/teams/:teamId/invite/email", zodValidator("json", EmailInput), async (c) => {
  const invite = await createInvite(getDb(c.env.DB), c.env, {
    teamId: c.req.param("teamId"),
    email: c.req.valid("json").email,
    createdBy: c.get("adminUserId"),
  });
  const out: CreateInviteOutput = {
    id: invite.id,
    email: invite.email,
    expiresAt: invite.expiresAt,
  };
  return c.json(out, 201);
});
