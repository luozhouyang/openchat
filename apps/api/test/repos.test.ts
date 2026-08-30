import { expect, test } from "vite-plus/test";
import { env } from "cloudflare:test";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { getDb } from "../src/db/client.ts";
import {
  createTeam,
  getTeam,
  listTeamsForUser,
  getTeamMember,
  addTeamMember,
  removeTeamMember,
  countTeamAdmins,
  listChannelIdsForUserInTeam,
} from "../src/db/repos/teams.ts";
import {
  createChannel,
  getChannel,
  getChannelByDedupKey,
  listChannelsForTeam,
  listChannelsForUser,
  getChannelMember,
  addChannelMember,
  removeChannelMember,
  listChannelMemberIds,
  listChannelsByIds,
} from "../src/db/repos/channels.ts";

const db = getDb(env.DB) as unknown as DrizzleD1Database;

test("structure tables exist after migration", async () => {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'",
  ).all<{ name: string }>();
  const names = results.map((r) => r.name);
  for (const table of [
    "teams",
    "team_members",
    "channels",
    "channel_members",
    "integrations",
    "system_settings",
  ]) {
    expect(names).toContain(table);
  }
});

test("team repo roundtrip", async () => {
  const team = await createTeam(db, {
    id: "team-roundtrip-1",
    name: "roundtrip-team-1",
    displayName: "Roundtrip Team 1",
    type: "open",
    inviteCode: "invite-roundtrip-1",
    creatorId: "user-a",
  });
  expect(team?.name).toBe("roundtrip-team-1");
  expect(team?.inviteCode).toBe("invite-roundtrip-1");

  const fetched = await getTeam(db, "team-roundtrip-1");
  expect(fetched?.displayName).toBe("Roundtrip Team 1");

  const mine = await listTeamsForUser(db, "user-a");
  expect(mine).toHaveLength(1);
  expect(mine[0]?.role).toBe("admin");

  await addTeamMember(db, { teamId: "team-roundtrip-1", userId: "user-b", role: "member" });
  expect((await getTeamMember(db, "team-roundtrip-1", "user-b"))?.role).toBe("member");
  expect(await countTeamAdmins(db, "team-roundtrip-1")).toBe(1);

  await removeTeamMember(db, "team-roundtrip-1", "user-b");
  expect(await getTeamMember(db, "team-roundtrip-1", "user-b")).toBeNull();
});

test("channel repo roundtrip", async () => {
  await createTeam(db, {
    id: "team-roundtrip-2",
    name: "roundtrip-team-2",
    displayName: "Roundtrip Team 2",
    type: "open",
    inviteCode: null,
    creatorId: "user-c",
  });

  const channel = await createChannel(db, {
    id: "channel-roundtrip-1",
    teamId: "team-roundtrip-2",
    name: "general",
    displayName: "General",
    type: "public",
    dedupKey: "dedup-roundtrip-1",
    creatorId: "user-c",
  });
  expect(channel?.name).toBe("general");
  expect(await getChannelByDedupKey(db, "dedup-roundtrip-1")).not.toBeNull();
  expect((await listChannelsForTeam(db, "team-roundtrip-2")).length).toBe(1);
  expect((await listChannelsForUser(db, "user-c")).length).toBe(1);
  expect(await listChannelIdsForUserInTeam(db, "team-roundtrip-2", "user-c")).toEqual([
    "channel-roundtrip-1",
  ]);
  expect((await listChannelsByIds(db, ["channel-roundtrip-1"])).length).toBe(1);
  expect((await listChannelsByIds(db, [])).length).toBe(0);

  await addChannelMember(db, {
    channelId: "channel-roundtrip-1",
    userId: "user-d",
    role: "member",
  });
  expect((await getChannelMember(db, "channel-roundtrip-1", "user-d"))?.role).toBe("member");
  expect(await listChannelMemberIds(db, "channel-roundtrip-1")).toContain("user-d");

  await removeChannelMember(db, "channel-roundtrip-1", "user-d");
  expect(await getChannelMember(db, "channel-roundtrip-1", "user-d")).toBeNull();
  expect(await getChannel(db, "channel-roundtrip-1")).not.toBeNull();
});
