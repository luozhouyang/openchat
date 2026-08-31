import { eq, and, gt, isNull } from "drizzle-orm";
import type { Invite, InviteInsert, Db } from "../types.ts";
import { invites } from "../schema-d1.ts";

export async function createInvite(db: Db, row: InviteInsert) {
  await db.insert(invites).values(row);
}

export async function getInvite(db: Db, id: string): Promise<Invite | null> {
  const rows = await db.select().from(invites).where(eq(invites.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getInviteByTokenHash(db: Db, tokenHash: string): Promise<Invite | null> {
  const rows = await db.select().from(invites).where(eq(invites.tokenHash, tokenHash)).limit(1);
  return rows[0] ?? null;
}

export async function hasPendingInvite(db: Db, teamId: string, email: string): Promise<boolean> {
  const rows = await db
    .select({ id: invites.id })
    .from(invites)
    .where(
      and(
        eq(invites.teamId, teamId),
        eq(invites.email, email),
        isNull(invites.consumedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, Date.now()),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function consumeInvite(db: Db, tokenHash: string, userId: string): Promise<boolean> {
  const existing = await getInviteByTokenHash(db, tokenHash);
  if (
    !existing ||
    existing.consumedAt !== null ||
    existing.revokedAt !== null ||
    existing.expiresAt < Date.now()
  ) {
    return false;
  }
  await db
    .update(invites)
    .set({ consumedAt: Date.now(), acceptedBy: userId })
    .where(eq(invites.tokenHash, tokenHash));
  return true;
}

export async function revokeInvite(db: Db, id: string) {
  await db
    .update(invites)
    .set({ revokedAt: Date.now() })
    .where(and(eq(invites.id, id), isNull(invites.consumedAt)));
}

export async function listTeamInvites(db: Db, teamId: string): Promise<Invite[]> {
  return db.select().from(invites).where(eq(invites.teamId, teamId));
}
