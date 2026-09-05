import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { WorkspaceResponse, type ChannelSummary, type ChannelType, type TeamType } from "protocol";
import { requireSession } from "@worker/auth/session";
import { resolvePermissions } from "@worker/auth/rbac";
import { getDb } from "@worker/db/client";
import { users } from "@worker/db/schema-d1";
import type { Db } from "@worker/db/types";
import { listTeamsForUser } from "@worker/db/repos/teams";
import {
  listChannelsForTeam,
  listChannelsForUser,
  listChannelMemberIds,
} from "@worker/db/repos/channels";
import { syncUserChannels } from "@worker/user-do-sync";
import { apiError } from "@worker/lib/errors";

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
  const teams = await Promise.all(
    teamsRows.map(async (t) => {
      const chs = await listChannelsForTeam(db, t.team.id);
      return {
        id: t.team.id,
        name: t.team.name,
        displayName: t.team.displayName,
        type: t.team.type as TeamType,
        roles: t.roles,
        archivedAt: t.team.archivedAt,
        channels: chs.map((ch) => toSummary(ch, myChannels.has(ch.id))),
      };
    }),
  );
  const directs = await Promise.all(
    allChannels
      .filter((r) => r.channel.teamId === null)
      .map(async (r) => {
        const summary = toSummary(r.channel, true);
        const allMemberIds = await listChannelMemberIds(db, r.channel.id);
        const memberIds = allMemberIds.filter((id) => id !== userId);
        summary.displayName = directDisplayName(r.channel.type, await memberNames(db, memberIds));
        return summary;
      }),
  );
  await syncUserChannels(c.env, userId);
  const out: WorkspaceResponse = { teams, directs };
  return c.json(out);
});

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
