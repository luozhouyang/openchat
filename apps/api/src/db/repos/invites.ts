import { eq, and, gt, isNull } from "drizzle-orm";
import { getDb } from "../client.ts";
import { invites } from "../schema-d1.ts";

type Db = ReturnType<typeof getDb>;

export async function createInvite(
  db: Db,
  row: {
    id: string;
    teamId: string;
    tokenHash: string;
    email: string;
    createdBy: string;
    createdAt: number;
    expiresAt: number;
  },
) {
  await db.insert(invites).values(row);
}

export async function getInvite(db: Db, id: string) {
  return (await db.select().from(invites).where(eq(invites.id, id)).limit(1))[0] ?? null;
}

export async function getInviteByTokenHash(db: Db, tokenHash: string) {
  return (
    (await db.select().from(invites).where(eq(invites.tokenHash, tokenHash)).limit(1))[0] ?? null
  );
}

export async function hasPendingInvite(db: Db, teamId: string, email: string) {
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

export async function consumeInvite(db: Db, tokenHash: string, userId: string) {
  const res = await db
    .update(invites)
    .set({ consumedAt: Date.now(), acceptedBy: userId })
    .where(
      and(
        eq(invites.tokenHash, tokenHash),
        isNull(invites.consumedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, Date.now()),
      ),
    );
  return res.meta.changes > 0;
}

export async function revokeInvite(db: Db, id: string) {
  await db
    .update(invites)
    .set({ revokedAt: Date.now() })
    .where(and(eq(invites.id, id), isNull(invites.consumedAt)));
}

export async function listTeamInvites(db: Db, teamId: string) {
  return db.select().from(invites).where(eq(invites.teamId, teamId));
}
