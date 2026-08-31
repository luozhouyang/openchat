import { eq } from "drizzle-orm";
import { id } from "protocol";
import type { Db } from "../db/types.ts";
import { users } from "../db/schema-d1.ts";
import * as repo from "../db/repos/invites.ts";
import { getTeam, getTeamMember, addTeamMember } from "../db/repos/teams.ts";
import { sendInviteEmail } from "../email.ts";
import { generateInviteToken, hashToken, maskEmail, normalizeEmail } from "../invites.ts";
import { apiError } from "../lib/errors.ts";

const TTL_MS = 48 * 3600_000;

export async function createInvite(
  db: Db,
  env: Env,
  { teamId, email, createdBy }: { teamId: string; email: string; createdBy: string },
) {
  const team = await getTeam(db, teamId);
  if (!team) throw apiError("not found", "team not found", 404);
  const normalized = normalizeEmail(email);
  if (await repo.hasPendingInvite(db, team.id, normalized))
    throw apiError("pending invite exists", "pending invite exists", 409);
  const token = generateInviteToken();
  const inviteId = id("inv");
  const expiresAt = Date.now() + TTL_MS;
  await repo.createInvite(db, {
    id: inviteId,
    teamId: team.id,
    tokenHash: await hashToken(token),
    email: normalized,
    createdBy,
    createdAt: Date.now(),
    expiresAt,
  });
  const inviteUrl = `${env.BETTER_AUTH_URL}/teams/invites/preview?token=${encodeURIComponent(token)}`;
  await sendInviteEmail(env, normalized, inviteUrl, team.displayName);
  return { id: inviteId, teamId: team.id, email: normalized, expiresAt };
}

export async function revokeInvite(
  db: Db,
  { teamId, inviteId }: { teamId: string; inviteId: string },
) {
  const invite = await repo.getInvite(db, inviteId);
  if (!invite || invite.teamId !== teamId) throw apiError("not found", "invite not found", 404);
  await repo.revokeInvite(db, invite.id);
  return { ok: true };
}

export async function previewInvite(db: Db, { token }: { token: string }) {
  const invite = await repo.getInviteByTokenHash(db, await hashToken(token));
  if (
    !invite ||
    invite.consumedAt !== null ||
    invite.revokedAt !== null ||
    invite.expiresAt < Date.now()
  ) {
    throw apiError("not found", "not found", 404);
  }
  const team = await getTeam(db, invite.teamId);
  if (!team || team.archivedAt) throw apiError("not found", "not found", 404);
  return {
    teamId: team.id,
    teamName: team.displayName,
    email: maskEmail(invite.email),
    expiresAt: invite.expiresAt,
  };
}

export async function acceptInvite(db: Db, { token, userId }: { token: string; userId: string }) {
  const userRows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = userRows[0];
  if (!user) throw apiError("unauthorized", "unauthorized", 401);
  const tokenHash = await hashToken(token);
  const invite = await repo.getInviteByTokenHash(db, tokenHash);
  if (
    !invite ||
    invite.consumedAt !== null ||
    invite.revokedAt !== null ||
    invite.expiresAt < Date.now()
  ) {
    throw apiError("invitation invalid", "invitation invalid", 400);
  }
  if (normalizeEmail(user.email) !== invite.email)
    throw apiError("invitation email mismatch", "invitation email mismatch", 403);
  const team = await getTeam(db, invite.teamId);
  if (!team || team.archivedAt) throw apiError("invitation invalid", "invitation invalid", 400);
  if (await getTeamMember(db, invite.teamId, userId)) return { ok: true, teamId: invite.teamId };

  const consumed = await repo.consumeInvite(db, tokenHash, userId);
  if (!consumed) throw apiError("invitation invalid", "invitation invalid", 400);
  await addTeamMember(db, { teamId: invite.teamId, userId, roles: "team_user" });
  return { ok: true, teamId: invite.teamId };
}
