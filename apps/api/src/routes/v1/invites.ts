import { Hono } from "hono";
import { z } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { requireSession } from "../../auth/session.ts";
import { requireTeamRole } from "../../auth/guards.ts";
import { getDb } from "../../db/client.ts";
import { getTeamMember } from "../../db/repos/teams.ts";
import * as repo from "../../db/repos/invites.ts";
import {
  createInvite,
  revokeInvite,
  previewInvite,
  acceptInvite,
} from "../../services/invite.service.ts";
import { HttpError } from "../../lib/errors.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EmailBody = z.object({ email: z.string().regex(EMAIL_RE) });
const InviteEmailBody = z.object({ team_id: z.string().min(1), email: z.string().regex(EMAIL_RE) });
const AcceptBody = z.object({ token: z.string().min(1) });

export const invitesV1 = new Hono<{ Bindings: Env }>();

invitesV1.post(
  "/teams/:teamId/invite/email",
  requireSession,
  requireTeamRole("admin"),
  async (c) => {
    const body = EmailBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid" }, 422);
    try {
      const invite = await createInvite(getDb(c.env.DB), c.env, {
        teamId: c.req.param("teamId"),
        email: body.data.email,
        createdBy: c.get("session")!.user.id,
      });
      return c.json({ id: invite.id, email: invite.email, expires_at: invite.expiresAt }, 201);
    } catch (err) {
      if (err instanceof HttpError)
        return c.json({ error: err.code }, err.status as ContentfulStatusCode);
      throw err;
    }
  },
);

invitesV1.post("/teams/invites/email", requireSession, async (c) => {
  const body = InviteEmailBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 422);
  const db = getDb(c.env.DB);
  const me = c.get("session")!.user.id;
  const member = await getTeamMember(db, body.data.team_id, me);
  if (!member || !member.roles.split(" ").includes("team_admin"))
    return c.json({ error: "forbidden" }, 403);
  try {
    const invite = await createInvite(db, c.env, {
      teamId: body.data.team_id,
      email: body.data.email,
      createdBy: me,
    });
    return c.json({ id: invite.id, email: invite.email, expires_at: invite.expiresAt }, 201);
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
});

invitesV1.get("/teams/:teamId/invites", requireSession, requireTeamRole("admin"), async (c) => {
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

invitesV1.get("/teams/invites/preview", async (c) => {
  const token = c.req.query("token") ?? "";
  if (!token) return c.json({ error: "not found" }, 404);
  try {
    const result = await previewInvite(getDb(c.env.DB), { token });
    return c.json(result);
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
});

invitesV1.post("/teams/invites/accept", requireSession, async (c) => {
  const body = AcceptBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 422);
  try {
    const result = await acceptInvite(getDb(c.env.DB), {
      token: body.data.token,
      userId: c.get("session")!.user.id,
    });
    return c.json(result);
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
});

invitesV1.post(
  "/teams/:teamId/invites/:inviteId/revoke",
  requireSession,
  requireTeamRole("admin"),
  async (c) => {
    try {
      await revokeInvite(getDb(c.env.DB), {
        teamId: c.req.param("teamId"),
        inviteId: c.req.param("inviteId"),
      });
    } catch (err) {
      if (err instanceof HttpError)
        return c.json({ error: err.code }, err.status as ContentfulStatusCode);
      throw err;
    }
    return c.json({ ok: true });
  },
);
