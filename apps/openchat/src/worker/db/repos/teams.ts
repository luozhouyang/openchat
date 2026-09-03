import { eq, and, like } from "drizzle-orm";
import type { Team, TeamMember, TeamMemberInsert, Db } from "../types.ts";
import { teams, teamMembers, channels, channelMembers } from "../schema-d1.ts";

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
    .values({ teamId: row.id, userId: row.creatorId, roles: "team_admin", joinedAt: now });
  return getTeam(db, row.id);
}

export async function getTeam(db: Db, teamId: string): Promise<Team | null> {
  const rows = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  return rows[0] ?? null;
}

export async function listTeamsForUser(db: Db, userId: string) {
  return db
    .select({ team: teams, roles: teamMembers.roles })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, userId));
}

export async function getTeamMember(
  db: Db,
  teamId: string,
  userId: string,
): Promise<TeamMember | null> {
  const rows = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function addTeamMember(db: Db, row: Omit<TeamMemberInsert, "joinedAt">) {
  await db.insert(teamMembers).values({ ...row, joinedAt: Date.now() });
}

export async function removeTeamMember(db: Db, teamId: string, userId: string) {
  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
}

export async function countTeamAdmins(db: Db, teamId: string): Promise<number> {
  const rows = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), like(teamMembers.roles, "%team_admin%")));
  return rows.length;
}

export async function listChannelIdsForUserInTeam(
  db: Db,
  teamId: string,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ channelId: channelMembers.channelId })
    .from(channelMembers)
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(and(eq(channels.teamId, teamId), eq(channelMembers.userId, userId)));
  return rows.map((r) => r.channelId);
}
