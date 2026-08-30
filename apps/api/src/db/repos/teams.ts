import { eq, and } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { teams, teamMembers, channels, channelMembers } from "../schema-d1.ts";

type Db = DrizzleD1Database;

export async function createTeam(
  db: Db,
  row: {
    id: string;
    name: string;
    displayName: string;
    type: string;
    inviteCode: string | null;
    creatorId: string;
  },
) {
  const now = Date.now();
  await db.insert(teams).values({ ...row, createdAt: now });
  await db
    .insert(teamMembers)
    .values({ teamId: row.id, userId: row.creatorId, role: "admin", joinedAt: now });
  return getTeam(db, row.id);
}

export async function getTeam(db: Db, teamId: string) {
  return (await db.select().from(teams).where(eq(teams.id, teamId)).limit(1))[0] ?? null;
}

export async function listTeamsForUser(db: Db, userId: string) {
  return db
    .select({ team: teams, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, userId));
}

export async function getTeamMember(db: Db, teamId: string, userId: string) {
  return (
    (
      await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
        .limit(1)
    )[0] ?? null
  );
}

export async function addTeamMember(db: Db, row: { teamId: string; userId: string; role: string }) {
  await db.insert(teamMembers).values({ ...row, joinedAt: Date.now() });
}

export async function removeTeamMember(db: Db, teamId: string, userId: string) {
  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
}

export async function countTeamAdmins(db: Db, teamId: string) {
  const rows = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "admin")));
  return rows.length;
}

export async function listChannelIdsForUserInTeam(db: Db, teamId: string, userId: string) {
  const rows = await db
    .select({ channelId: channelMembers.channelId })
    .from(channelMembers)
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(and(eq(channels.teamId, teamId), eq(channelMembers.userId, userId)));
  return rows.map((r) => r.channelId);
}
