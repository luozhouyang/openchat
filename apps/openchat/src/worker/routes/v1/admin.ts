import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { channelDoName } from "protocol";
import { RemoveMemberInput, type AdminStatsOutput } from "protocol";
import { requireAdmin } from "../../auth/admin-gate.ts";
import type { SessionContext } from "../../auth/session.ts";
import { getDb } from "../../db/client.ts";
import { users, teams, channels, teamMembers, channelMembers } from "../../db/schema-d1.ts";
import { listChannelsForTeam, listChannelMemberIds } from "../../db/repos/channels.ts";
import { removeChannelMemberFromDo, syncUserChannels } from "../../user-do-sync.ts";
import { auditLog } from "../../audit.ts";
import { zodValidator } from "../../lib/validation.ts";

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
  auditLog({ actor: c.get("adminUserId"), action: "team.archive", target: teamId, status: "ok" });
  return c.json({ ok: true });
});
adminV1.post("/channels/:channelId/archive", async (c) => {
  const db = getDb(c.env.DB);
  const channelId = c.req.param("channelId");
  await db.update(channels).set({ archivedAt: Date.now() }).where(eq(channels.id, channelId));
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
  await db.delete(channelMembers).where(eq(channelMembers.channelId, channelId));
  await db.delete(channels).where(eq(channels.id, channelId));
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
      }
    }
    await db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    await syncUserChannels(c.env, userId);
    auditLog({
      actor: c.get("adminUserId"),
      action: "team.member.remove",
      target: `${teamId}/${userId}`,
      status: "ok",
    });
    return c.json({ ok: true });
  },
);
