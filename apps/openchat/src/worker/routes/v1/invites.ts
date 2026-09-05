import { Hono } from "hono";
import { z } from "zod";
import {
  idSchema,
  EmailInput,
  InviteEmailInput,
  AcceptInviteInput,
  type CreateInviteOutput,
  type InvitesListOutput,
  type InvitePreviewOutput,
  type AcceptInviteOutput,
} from "protocol";
import { requireSession } from "@worker/auth/session";
import { requireTeamRole } from "@worker/auth/guards";
import { getDb } from "@worker/db/client";
import { getTeamMember } from "@worker/db/repos/teams";
import * as repo from "@worker/db/repos/invites";
import {
  createInvite,
  revokeInvite,
  previewInvite,
  acceptInvite,
} from "@worker/services/invite.service";
import { apiError } from "@worker/lib/errors";
import { zodValidator } from "@worker/lib/validation";

export const invitesV1 = new Hono<{ Bindings: Env }>();

invitesV1.post(
  "/teams/:teamId/invite/email",
  requireSession,
  requireTeamRole("admin"),
  zodValidator("json", EmailInput),
  async (c) => {
    const body = c.req.valid("json");
    const invite = await createInvite(getDb(c.env.DB), c.env, {
      teamId: c.req.param("teamId"),
      email: body.email,
      createdBy: c.get("session")!.user.id,
    });
    const out: CreateInviteOutput = {
      id: invite.id,
      email: invite.email,
      expiresAt: invite.expiresAt,
    };
    return c.json(out, 201);
  },
);
invitesV1.post(
  "/teams/invites/email",
  requireSession,
  zodValidator("json", InviteEmailInput),
  async (c) => {
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);
    const me = c.get("session")!.user.id;
    const member = await getTeamMember(db, body.teamId, me);
    if (!member || !member.roles.split(" ").includes("team_admin")) {
      throw apiError("forbidden", "forbidden", 403);
    }
    const invite = await createInvite(db, c.env, {
      teamId: body.teamId,
      email: body.email,
      createdBy: me,
    });
    const out: CreateInviteOutput = {
      id: invite.id,
      email: invite.email,
      expiresAt: invite.expiresAt,
    };
    return c.json(out, 201);
  },
);
invitesV1.get("/teams/:teamId/invites", requireSession, requireTeamRole("admin"), async (c) => {
  const db = getDb(c.env.DB);
  const rows = await repo.listTeamInvites(db, c.req.param("teamId"));
  const out: InvitesListOutput = {
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
  };
  return c.json(out);
});
invitesV1.get(
  "/teams/invites/preview",
  zodValidator("query", z.object({ token: idSchema })),
  async (c) => {
    const body = c.req.valid("query");
    const result = await previewInvite(getDb(c.env.DB), { token: body.token });
    return c.json(result as InvitePreviewOutput);
  },
);
invitesV1.post(
  "/teams/invites/accept",
  requireSession,
  zodValidator("json", AcceptInviteInput),
  async (c) => {
    const body = c.req.valid("json");
    const result = await acceptInvite(getDb(c.env.DB), {
      token: body.token,
      userId: c.get("session")!.user.id,
    });
    return c.json(result as AcceptInviteOutput);
  },
);
invitesV1.post(
  "/teams/:teamId/invites/:inviteId/revoke",
  requireSession,
  requireTeamRole("admin"),
  async (c) => {
    await revokeInvite(getDb(c.env.DB), {
      teamId: c.req.param("teamId"),
      inviteId: c.req.param("inviteId"),
    });
    return c.json({ ok: true });
  },
);
