import { eq } from "drizzle-orm";
import { id } from "protocol";
import { getDb } from "../db/client.ts";
import { teams, teamMembers } from "../db/schema-d1.ts";
import {
  getTeam,
  getTeamMember,
  addTeamMember,
  removeTeamMember,
  countTeamAdmins,
} from "../db/repos/teams.ts";
import { apiError } from "../lib/errors.ts";

type Db = ReturnType<typeof getDb>;

function inviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export type CreateTeamInput = {
  name: string;
  displayName: string;
  type: "open" | "invite";
  description?: string;
  creatorId: string;
};

export async function createTeam(
  db: Db,
  input: CreateTeamInput,
): Promise<{ id: string; inviteCode?: string }> {
  const teamId = id("team");
  const code = input.type === "invite" ? inviteCode() : null;
  const now = Date.now();
  await db
    .insert(teams)
    .values({
      id: teamId,
      name: input.name,
      displayName: input.displayName,
      type: input.type,
      description: input.description ?? null,
      inviteCode: code,
      creatorId: input.creatorId,
      createdAt: now,
    })
    .onConflictDoNothing();
  const team = await getTeam(db, teamId);
  if (!team) throw apiError("name_taken", "name taken", 409);
  await db.insert(teamMembers).values({
    teamId,
    userId: input.creatorId,
    roles: "team_admin",
    joinedAt: now,
  });
  return code ? { id: teamId, inviteCode: code } : { id: teamId };
}

export async function joinTeam(
  db: Db,
  input: { teamId: string; userId: string; inviteCode?: string },
): Promise<void> {
  const team = await getTeam(db, input.teamId);
  if (!team) throw apiError("not found", "not found", 404);
  if (team.type === "invite" && input.inviteCode !== team.inviteCode)
    throw apiError("forbidden", "forbidden", 403);
  if (await getTeamMember(db, input.teamId, input.userId)) return;
  await addTeamMember(db, { teamId: input.teamId, userId: input.userId, roles: "team_user" });
}

export async function leaveTeam(db: Db, input: { teamId: string; userId: string }): Promise<void> {
  const member = await getTeamMember(db, input.teamId, input.userId);
  if (!member) return;
  if (
    member.roles.split(" ").includes("team_admin") &&
    (await countTeamAdmins(db, input.teamId)) <= 1
  ) {
    throw apiError("transfer_admin_first", "transfer admin first", 409);
  }
  await removeTeamMember(db, input.teamId, input.userId);
}

export type TeamPatch = {
  displayName?: string;
  description?: string;
  archived?: boolean;
};

export async function updateTeam(
  db: Db,
  input: { teamId: string; patch: TeamPatch },
): Promise<void> {
  const values: Partial<typeof teams.$inferInsert> = {};
  if (input.patch.displayName !== undefined) values.displayName = input.patch.displayName;
  if (input.patch.description !== undefined) values.description = input.patch.description;
  if (input.patch.archived !== undefined)
    values.archivedAt = input.patch.archived ? Date.now() : null;
  await db.update(teams).set(values).where(eq(teams.id, input.teamId));
}
