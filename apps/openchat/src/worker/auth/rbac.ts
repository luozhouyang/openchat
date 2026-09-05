import { eq, inArray } from "drizzle-orm";
import { id } from "protocol";
import { getDb } from "@worker/db/client";
import { getChannelMember } from "@worker/db/repos/channels";
import { createRole, getRoleByName } from "@worker/db/repos/roles";
import { getTeamMember } from "@worker/db/repos/teams";
import { roles, users } from "@worker/db/schema-d1";

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
  CREATE_TEAM: "create_team",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const SYSTEM_USER_PERMS: Permission[] = [
  PERMISSIONS.VIEW_TEAM,
  PERMISSIONS.JOIN_PUBLIC_TEAMS,
  PERMISSIONS.CREATE_PUBLIC_CHANNEL,
  PERMISSIONS.CREATE_PRIVATE_CHANNEL,
  PERMISSIONS.READ_CHANNEL,
  PERMISSIONS.CREATE_POST,
  PERMISSIONS.EDIT_POST,
  PERMISSIONS.DELETE_POST,
  PERMISSIONS.ADD_REACTION,
  PERMISSIONS.REMOVE_REACTION,
  PERMISSIONS.USE_GROUP_MENTIONS,
  PERMISSIONS.VIEW_MEMBERS,
  PERMISSIONS.CREATE_TEAM,
];

const TEAM_USER_PERMS: Permission[] = [
  PERMISSIONS.VIEW_TEAM,
  PERMISSIONS.CREATE_PUBLIC_CHANNEL,
  PERMISSIONS.CREATE_PRIVATE_CHANNEL,
  PERMISSIONS.READ_CHANNEL,
  PERMISSIONS.CREATE_POST,
  PERMISSIONS.EDIT_POST,
  PERMISSIONS.DELETE_POST,
  PERMISSIONS.ADD_REACTION,
  PERMISSIONS.REMOVE_REACTION,
  PERMISSIONS.VIEW_MEMBERS,
];

const CHANNEL_USER_PERMS: Permission[] = [
  PERMISSIONS.READ_CHANNEL,
  PERMISSIONS.CREATE_POST,
  PERMISSIONS.EDIT_POST,
  PERMISSIONS.DELETE_POST,
  PERMISSIONS.ADD_REACTION,
  PERMISSIONS.REMOVE_REACTION,
];

export const SEED_ROLES: Record<string, Permission[]> = {
  system_user: SYSTEM_USER_PERMS,
  system_admin: [
    ...SYSTEM_USER_PERMS,
    PERMISSIONS.MANAGE_SYSTEM,
    PERMISSIONS.MANAGE_ROLES,
    PERMISSIONS.MANAGE_TEAMS,
    PERMISSIONS.MANAGE_CHANNELS,
    PERMISSIONS.MANAGE_USERS,
    PERMISSIONS.DELETE_OTHERS_POSTS,
    PERMISSIONS.MANAGE_PUBLIC_CHANNEL_MEMBERS,
    PERMISSIONS.MANAGE_PRIVATE_CHANNEL_MEMBERS,
    PERMISSIONS.REMOVE_USER_FROM_TEAM,
  ],
  team_user: TEAM_USER_PERMS,
  team_admin: [
    ...TEAM_USER_PERMS,
    PERMISSIONS.MANAGE_TEAMS,
    PERMISSIONS.MANAGE_PUBLIC_CHANNEL_MEMBERS,
    PERMISSIONS.MANAGE_PRIVATE_CHANNEL_MEMBERS,
    PERMISSIONS.DELETE_PUBLIC_CHANNEL,
    PERMISSIONS.DELETE_PRIVATE_CHANNEL,
    PERMISSIONS.REMOVE_USER_FROM_TEAM,
    PERMISSIONS.INVITE_USER,
  ],
  channel_user: CHANNEL_USER_PERMS,
  channel_admin: [
    ...CHANNEL_USER_PERMS,
    PERMISSIONS.MANAGE_PUBLIC_CHANNEL_MEMBERS,
    PERMISSIONS.MANAGE_PRIVATE_CHANNEL_MEMBERS,
    PERMISSIONS.DELETE_PUBLIC_CHANNEL,
    PERMISSIONS.DELETE_PRIVATE_CHANNEL,
    PERMISSIONS.MANAGE_CHANNEL_ROLES,
  ],
};

export async function ensureSeedRoles(db: Db): Promise<void> {
  for (const [name, perms] of Object.entries(SEED_ROLES)) {
    if (await getRoleByName(db, name)) {
      continue;
    }
    await createRole(db, {
      id: id("rol"),
      name,
      displayName: name,
      description: `built-in ${name}`,
      permissions: JSON.stringify(perms),
      builtIn: true,
    });
  }
}

export async function resolvePermissions(
  db: Db,
  userId: string,
  scope: { teamId?: string; channelId?: string } = {},
): Promise<Set<Permission>> {
  const perms = new Set<Permission>();
  const names = new Set<string>();

  const userRows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = userRows[0];
  names.add(user?.role === "admin" ? "system_admin" : "system_user");

  if (scope.teamId) {
    const member = await getTeamMember(db, scope.teamId, userId);
    if (member) {
      for (const name of member.roles.split(" ")) {
        names.add(name);
      }
    }
  }
  if (scope.channelId) {
    const member = await getChannelMember(db, scope.channelId, userId);
    if (member) {
      for (const name of member.roles.split(" ")) {
        names.add(name);
      }
    }
  }

  const roleRows = await db
    .select({ permissions: roles.permissions })
    .from(roles)
    .where(inArray(roles.name, [...names]));

  for (const row of roleRows) {
    try {
      const arr = JSON.parse(row.permissions) as unknown;
      if (Array.isArray(arr)) {
        for (const p of arr) {
          if (typeof p === "string") {
            perms.add(p as Permission);
          }
        }
      }
    } catch {
      // invalid permission JSON is ignored
    }
  }
  return perms;
}
