import { expect, test } from "vite-plus/test";
import { env } from "cloudflare:test";
import { getDb } from "../../src/db/client.ts";
import { createTeam, listChannelIdsForUserInTeam } from "../../src/db/repos/teams.ts";
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
} from "../../src/db/repos/channels.ts";

const db = getDb(env.DB);

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

  const creatorMember = await getChannelMember(db, "channel-roundtrip-1", "user-c");
  expect(creatorMember?.roles).toBe("channel_admin");

  await addChannelMember(db, {
    channelId: "channel-roundtrip-1",
    userId: "user-d",
    roles: "channel_user",
  });
  expect((await getChannelMember(db, "channel-roundtrip-1", "user-d"))?.roles).toBe("channel_user");
  expect(await listChannelMemberIds(db, "channel-roundtrip-1")).toContain("user-d");

  await removeChannelMember(db, "channel-roundtrip-1", "user-d");
  expect(await getChannelMember(db, "channel-roundtrip-1", "user-d")).toBeNull();
  expect(await getChannel(db, "channel-roundtrip-1")).not.toBeNull();
});
