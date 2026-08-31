import { eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { getChannelMember } from "../db/repos/channels.ts";
import { getRoleByName } from "../db/repos/roles.ts";
import { getTeamMember } from "../db/repos/teams.ts";
import { users } from "../db/schema-auth.ts";

type Db = ReturnType<typeof getDb>;

export const PERMISSIONS = {
  VIEW_TEAM: "view_team",
  JOIN_PUBLIC_TEAMS: "join_public_teams",
  CREATE_PUBLIC_CHANNEL: "create_public_channel",
  CREATE_PRIVATE_CHANNEL: "create_private_channel",
  READ_CHANNEL: "read_channel",
  CREATE_POST: "create_post",
  EDIT_POST: "edit_post",
  DELETE_POST: "delete_post",
  ADD_REACTION: "add_reaction",
  REMOVE_REACTION: "remove_reaction",
  USE_GROUP_MENTIONS: "use_group_mentions",
  VIEW_MEMBERS: "view_members",
  MANAGE_SYSTEM: "manage_system",
  MANAGE_ROLES: "manage_roles",
  MANAGE_TEAMS: "manage_teams",
  MANAGE_CHANNELS: "manage_channels",
  MANAGE_USERS: "manage_users",
  DELETE_OTHERS_POSTS: "delete_others_posts",
  MANAGE_PUBLIC_CHANNEL_MEMBERS: "manage_public_channel_members",
  MANAGE_PRIVATE_CHANNEL_MEMBERS: "manage_private_channel_members",
  REMOVE_USER_FROM_TEAM: "remove_user_from_team",
  INVITE_USER: "invite_user",
  MANAGE_CHANNEL_ROLES: "manage_channel_roles",
  DELETE_PUBLIC_CHANNEL: "delete_public_channel",
  DELETE_PRIVATE_CHANNEL: "delete_private_channel",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

function unionRolePermissions(perms: Set<string>, role: { permissions: string } | null) {
  if (!role) return;
  try {
    const arr = JSON.parse(role.permissions) as unknown;
    if (Array.isArray(arr)) {
      for (const p of arr) if (typeof p === "string") perms.add(p);
    }
  } catch {
    // invalid permission JSON is ignored
  }
}

export async function resolvePermissions(
  db: Db,
  userId: string,
  scope: { teamId?: string; channelId?: string } = {},
): Promise<Set<string>> {
  const perms = new Set<string>();
  const user = (
    await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  perms.add(user?.role === "admin" ? "system_admin" : "system_user");

  if (scope.teamId) {
    const member = await getTeamMember(db, scope.teamId, userId);
    if (member) {
      for (const name of member.roles.split(" ")) {
        unionRolePermissions(perms, await getRoleByName(db, name));
      }
    }
  }
  if (scope.channelId) {
    const member = await getChannelMember(db, scope.channelId, userId);
    if (member) {
      for (const name of member.roles.split(" ")) {
        unionRolePermissions(perms, await getRoleByName(db, name));
      }
    }
  }
  return perms;
}
