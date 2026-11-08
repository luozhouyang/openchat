import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import {
  WorkspaceResponse,
  type ChannelSummary,
  type ChannelType,
  type TeamType,
  UserAutocompleteOutput,
  UserAutocompleteQuery,
} from "protocol";
import { requireSession } from "@worker/auth/session";
import { resolvePermissions } from "@worker/auth/rbac";
import { getDb } from "@worker/db/client";
import { users } from "@worker/db/schema-d1";
import type { Db } from "@worker/db/types";
import { listTeamsForUser } from "@worker/db/repos/teams";
import { searchUsers } from "@worker/db/repos/user-search";
import {
  listChannelsForUser,
  listChannelsForTeams,
  listChannelMembersWithNames,
  type ChannelMemberWithName,
} from "@worker/db/repos/channels";
import type { Channel } from "@worker/db/types";
import { syncUserChannels } from "@worker/user-do-sync";
import { apiError } from "@worker/lib/errors";
import { zodValidator } from "@worker/lib/validation";

export const usersV1 = new Hono<{ Bindings: Env }>();

usersV1.get("/users/me", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const session = c.get("session")!;
  const rows = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw apiError("not_found", "not found", 404);
  }
  return c.json({
    user: {
      id: row.id,
      email: row.email,
      username: row.username ?? null,
      nickname: row.nickname ?? null,
      avatarUrl: row.avatarUrl ?? row.image ?? null,
      createdAt: row.createdAt.toISOString(),
      permissions: [...(await resolvePermissions(db, row.id))],
    },
  });
});

usersV1.get("/users/me/workspaces", requireSession, async (c) => {
  const db = getDb(c.env.DB);
  const userId = c.get("session")!.user.id;
  const teamsRows = await listTeamsForUser(db, userId);
  const allChannels = await listChannelsForUser(db, userId);
  const myChannels = new Set(allChannels.map((r) => r.channel.id));
  const toSummary = (
    ch: (typeof allChannels)[number]["channel"],
    member: boolean,
  ): ChannelSummary => ({
    id: ch.id,
    teamId: ch.teamId,
    name: ch.name,
    displayName: ch.displayName,
    type: ch.type as ChannelType,
    member,
    archivedAt: ch.archivedAt,
  });
  // N+1 fix: team channels and DM/GM member names (the previous per-team
  // `listChannelsForTeam` + per-direct `listChannelMemberIds`/`memberNames`
  // round trips) are replaced by two batched queries. Same aggregation shape —
  // teams keep their order, channels/directs keep their member/summary shape.
  const teamChannelRows = await listChannelsForTeams(
    db,
    teamsRows.map((t) => t.team.id),
  );
  const channelsByTeam = new Map<string, Channel[]>();
  for (const ch of teamChannelRows) {
    const list = channelsByTeam.get(ch.teamId!) ?? [];
    list.push(ch);
    channelsByTeam.set(ch.teamId!, list);
  }
  const directs = allChannels.filter((r) => r.channel.teamId === null);
  const directMemberRows = await listChannelMembersWithNames(
    db,
    directs.map((r) => r.channel.id),
  );
  const membersByChannel = new Map<string, ChannelMemberWithName[]>();
  for (const row of directMemberRows) {
    const list = membersByChannel.get(row.channelId) ?? [];
    list.push(row);
    membersByChannel.set(row.channelId, list);
  }
  const teams = teamsRows.map((t) => ({
    id: t.team.id,
    name: t.team.name,
    displayName: t.team.displayName,
    type: t.team.type as TeamType,
    roles: t.roles,
    archivedAt: t.team.archivedAt,
    channels: (channelsByTeam.get(t.team.id) ?? []).map((ch) =>
      toSummary(ch, myChannels.has(ch.id)),
    ),
  }));
  const directSummaries = directs.map((r) => {
    const summary = toSummary(r.channel, true);
    // Each member sees the OTHER members' names (same rule as the
    // personalized channel.created delivery).
    const names = (membersByChannel.get(r.channel.id) ?? [])
      .filter((m) => m.userId !== userId)
      .map((m) => m.nickname ?? m.name ?? m.email ?? "");
    summary.displayName = directDisplayName(r.channel.type, names);
    return summary;
  });
  // Diff-then-write: the UserDO diffs this cached set internally and only
  // rewrites when the membership actually changed, so the hot sidebar GET no
  // longer pays an unconditional UserDO cache write every time.
  await syncUserChannels(c.env, userId, [...myChannels]);
  const out: WorkspaceResponse = { teams, directs: directSummaries };
  return c.json(out);
});

usersV1.get(
  "/users/autocomplete",
  requireSession,
  zodValidator("query", UserAutocompleteQuery),
  async (c) => {
    const { term, limit } = c.req.valid("query");
    if (!term?.trim()) {
      return c.json({ users: [] } satisfies UserAutocompleteOutput);
    }
    const db = getDb(c.env.DB);
    const me = c.get("session")!.user.id;
    const users = await searchUsers(db, term, { limit: limit ?? 20, excludeUserId: me });
    return c.json({ users } satisfies UserAutocompleteOutput);
  },
);

export async function memberNames(db: Db, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({ nickname: users.nickname, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, userIds));
  return rows.map((u) => u.nickname ?? u.name ?? u.email);
}

export function directDisplayName(type: string, names: string[]): string {
  if (names.length === 0) {
    return type === "dm" ? "私聊" : "群组";
  }
  if (type === "dm") {
    return names[0];
  }
  const head = names.slice(0, 2).join(", ");
  const rest = names.length - 2;
  return rest > 0 ? `${head}, +${rest}` : head;
}
