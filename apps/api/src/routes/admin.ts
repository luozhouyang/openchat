import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "../auth/admin-gate.ts";
import type { SessionContext } from "../auth/session.ts";
import { getDb } from "../db/client.ts";
import { teams, channels, teamMembers, channelMembers } from "../db/schema-d1.ts";
import { listChannelsForTeam, listChannelMemberIds } from "../db/repos/channels.ts";
import { removeChannelMemberFromDo, syncUserChannels } from "../user-do-sync.ts";
import { auditLog } from "../audit.ts";

export const adminRoutes = new Hono<{
  Bindings: Env;
  Variables: { session: SessionContext; adminUserId: string };
}>();
adminRoutes.use("*", requireAdmin);

adminRoutes.get("/settings", (c) => c.json({ openRegistration: true }));

adminRoutes.post("/teams/:teamId/archive", async (c) => {
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

adminRoutes.post("/channels/:channelId/archive", async (c) => {
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

adminRoutes.post("/channels/:channelId/delete", async (c) => {
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

adminRoutes.post("/teams/:teamId/members/remove", async (c) => {
  const body = z.object({ userId: z.string().min(1) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  const teamId = c.req.param("teamId");
  const userId = body.data.userId;
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
});
