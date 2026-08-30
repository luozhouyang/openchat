import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { newId } from "protocol";
import { requireSession } from "../auth/session.ts";
import { requireTeamRole } from "../auth/guards.ts";
import { getDb } from "../db/client.ts";
import { users } from "../db/schema-d1.ts";
import * as repo from "../db/repos/invites.ts";
import { getTeam, getTeamMember, addTeamMember } from "../db/repos/teams.ts";
import { generateInviteToken, hashToken, maskEmail, normalizeEmail } from "../invites.ts";
import { sendInviteEmail } from "../email.ts";

export const inviteRoutes = new Hono<{ Bindings: Env }>();

const TTL_MS = 48 * 3600_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

inviteRoutes.post("/teams/:teamId/invites", requireSession, requireTeamRole("admin"), async (c) => {
  const body = z.object({ email: z.string().regex(EMAIL_RE) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  const team = await getTeam(db, c.req.param("teamId"));
  if (!team) return c.json({ error: "not found" }, 404);
  const email = normalizeEmail(body.data.email);
  if (await repo.hasPendingInvite(db, team.id, email))
    return c.json({ error: "pending invite exists" }, 409);
  const token = generateInviteToken();
  const id = newId();
  const expiresAt = Date.now() + TTL_MS;
  await repo.createInvite(db, {
    id,
    teamId: team.id,
    tokenHash: await hashToken(token),
    email,
    createdBy: c.get("session")!.user.id,
    createdAt: Date.now(),
    expiresAt,
  });
  const inviteUrl = `${c.env.BETTER_AUTH_URL}/teams/invites/preview?token=${encodeURIComponent(token)}`;
  await sendInviteEmail(c.env, email, inviteUrl, team.displayName);
  return c.json({ id, teamId: team.id, email, expiresAt }, 201);
});

inviteRoutes.get("/teams/:teamId/invites", requireSession, requireTeamRole("admin"), async (c) => {
  const db = getDb(c.env.DB);
  const rows = await repo.listTeamInvites(db, c.req.param("teamId"));
  return c.json({
    invites: rows.map((r) => ({
      id: r.id,
      email: r.email,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      consumedAt: r.consumedAt,
      revokedAt: r.revokedAt,
      acceptedBy: r.acceptedBy,
    })),
  });
});

inviteRoutes.post(
  "/teams/:teamId/invites/:inviteId/revoke",
  requireSession,
  requireTeamRole("admin"),
  async (c) => {
    const db = getDb(c.env.DB);
    const invite = await repo.getInvite(db, c.req.param("inviteId"));
    if (!invite || invite.teamId !== c.req.param("teamId"))
      return c.json({ error: "not found" }, 404);
    await repo.revokeInvite(db, invite.id);
    return c.json({ ok: true });
  },
);

inviteRoutes.get("/teams/invites/preview", async (c) => {
  const token = c.req.query("token") ?? "";
  if (!token) return c.json({ error: "not found" }, 404);
  const db = getDb(c.env.DB);
  const invite = await repo.getInviteByTokenHash(db, await hashToken(token));
  if (
    !invite ||
    invite.consumedAt !== null ||
    invite.revokedAt !== null ||
    invite.expiresAt < Date.now()
  ) {
    return c.json({ error: "not found" }, 404);
  }
  const team = await getTeam(db, invite.teamId);
  if (!team || team.archivedAt) return c.json({ error: "not found" }, 404);
  return c.json({
    teamId: team.id,
    teamName: team.displayName,
    email: maskEmail(invite.email),
    expiresAt: invite.expiresAt,
  });
});

inviteRoutes.post("/teams/invites/accept", requireSession, async (c) => {
  const body = z.object({ token: z.string().min(1) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  const userId = c.get("session")!.user.id;
  const user = (
    await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const invite = await repo.getInviteByTokenHash(db, await hashToken(body.data.token));
  if (
    !invite ||
    invite.consumedAt !== null ||
    invite.revokedAt !== null ||
    invite.expiresAt < Date.now()
  ) {
    return c.json({ error: "invitation invalid" }, 400);
  }
  if (normalizeEmail(user.email) !== invite.email)
    return c.json({ error: "invitation email mismatch" }, 403);
  if (await getTeamMember(db, invite.teamId, userId))
    return c.json({ ok: true, teamId: invite.teamId });
  if (!(await repo.consumeInvite(db, invite.tokenHash, userId)))
    return c.json({ error: "invitation invalid" }, 400);
  await addTeamMember(db, { teamId: invite.teamId, userId, role: "member" });
  return c.json({ ok: true, teamId: invite.teamId });
});
