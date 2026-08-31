import { expect, test } from "vite-plus/test";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client.ts";
import { channels, channelMembers } from "../../src/db/schema-d1.ts";
import {
  createChannel,
  openDirect,
  openGroup,
  joinChannel,
  leaveChannel,
  archiveChannel,
  restoreChannel,
} from "../../src/services/channel.service.ts";
import { createTeam, joinTeam } from "../../src/services/team.service.ts";
import { HttpError } from "../../src/lib/errors.ts";

const db = getDb(env.DB);

async function expectHttpError(p: Promise<unknown>, code: string, status: number) {
  try {
    await p;
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).code).toBe(code);
    expect((err as HttpError).status).toBe(status);
  }
}

test("createChannel writes channel and creator admin member", async () => {
  const db = getDb(env.DB);
  const ch = await createChannel(db, {
    teamId: "team-svc-ch",
    name: "general",
    displayName: "General",
    type: "public",
    purpose: "hello",
    header: "hi",
    creatorId: "user-svc-ch",
  });
  expect(ch.id).toMatch(/^chn_/);
  expect(ch.purpose).toBe("hello");

  const memberRows = await db
    .select()
    .from(channelMembers)
    .where(eq(channelMembers.channelId, ch.id));
  expect(memberRows).toHaveLength(1);
  expect(memberRows[0].userId).toBe("user-svc-ch");
  expect(memberRows[0].roles).toBe("channel_admin");
});

test("createChannel duplicate name in team throws 409", async () => {
  const db = getDb(env.DB);
  await createChannel(db, {
    teamId: "team-svc-ch-dup",
    name: "general",
    displayName: "General",
    type: "public",
    creatorId: "user-svc-1",
  });
  await expectHttpError(
    createChannel(db, {
      teamId: "team-svc-ch-dup",
      name: "general",
      displayName: "General 2",
      type: "public",
      creatorId: "user-svc-2",
    }),
    "name_taken",
    409,
  );
});

test("openDirect is idempotent for the same pair", async () => {
  const db = getDb(env.DB);
  const first = await openDirect(db, { userId: "user-dm-a", withUserId: "user-dm-b" });
  expect(first.existing).toBe(false);
  const second = await openDirect(db, { userId: "user-dm-b", withUserId: "user-dm-a" });
  expect(second.existing).toBe(true);
  expect(second.id).toBe(first.id);

  const memberRows = await db
    .select()
    .from(channelMembers)
    .where(eq(channelMembers.channelId, first.id));
  expect(memberRows.map((r) => r.userId).sort()).toEqual(["user-dm-a", "user-dm-b"]);
});

test("openGroup is idempotent and order-insensitive", async () => {
  const db = getDb(env.DB);
  const first = await openGroup(db, {
    userId: "user-gm-a",
    userIds: ["user-gm-b", "user-gm-c"],
  });
  expect(first.existing).toBe(false);
  const second = await openGroup(db, {
    userId: "user-gm-c",
    userIds: ["user-gm-a", "user-gm-b"],
  });
  expect(second.existing).toBe(true);
  expect(second.id).toBe(first.id);

  const memberRows = await db
    .select()
    .from(channelMembers)
    .where(eq(channelMembers.channelId, first.id));
  expect(memberRows.map((r) => r.userId).sort()).toEqual(["user-gm-a", "user-gm-b", "user-gm-c"]);
});

test("joinChannel joins public channel when team member", async () => {
  const db = getDb(env.DB);
  const { id: teamId } = await createTeam(db, {
    name: "svc-ch-team",
    displayName: "Ch Team",
    type: "open",
    creatorId: "user-svc-owner",
  });
  await joinTeam(db, { teamId, userId: "user-svc-member" });
  const ch = await createChannel(db, {
    teamId,
    name: "public",
    displayName: "Public",
    type: "public",
    creatorId: "user-svc-owner",
  });

  expect(await joinChannel(db, { channelId: ch.id, userId: "user-svc-member" })).toBe(true);
  expect(await joinChannel(db, { channelId: ch.id, userId: "user-svc-member" })).toBe(false);
});

test("joinChannel forbids private channel", async () => {
  const db = getDb(env.DB);
  const { id: teamId } = await createTeam(db, {
    name: "svc-ch-priv",
    displayName: "Priv",
    type: "open",
    creatorId: "user-svc-owner2",
  });
  await joinTeam(db, { teamId, userId: "user-svc-member2" });
  const ch = await createChannel(db, {
    teamId,
    name: "secret",
    displayName: "Secret",
    type: "private",
    creatorId: "user-svc-owner2",
  });
  await expectHttpError(
    joinChannel(db, { channelId: ch.id, userId: "user-svc-member2" }),
    "forbidden",
    403,
  );
});

test("joinChannel forbids non-team-member", async () => {
  const db = getDb(env.DB);
  const { id: teamId } = await createTeam(db, {
    name: "svc-ch-outside",
    displayName: "Outside",
    type: "open",
    creatorId: "user-svc-owner3",
  });
  const ch = await createChannel(db, {
    teamId,
    name: "public",
    displayName: "Public",
    type: "public",
    creatorId: "user-svc-owner3",
  });
  await expectHttpError(
    joinChannel(db, { channelId: ch.id, userId: "user-svc-outsider" }),
    "forbidden",
    403,
  );
});

test("joinChannel missing channel throws 404", async () => {
  const db = getDb(env.DB);
  await expectHttpError(
    joinChannel(db, { channelId: "chn_nope", userId: "user-svc-x" }),
    "not found",
    404,
  );
});

test("leaveChannel removes membership", async () => {
  const db = getDb(env.DB);
  const { id: teamId } = await createTeam(db, {
    name: "svc-ch-leave",
    displayName: "Leave",
    type: "open",
    creatorId: "user-svc-owner4",
  });
  await joinTeam(db, { teamId, userId: "user-svc-member4" });
  const ch = await createChannel(db, {
    teamId,
    name: "public",
    displayName: "Public",
    type: "public",
    creatorId: "user-svc-owner4",
  });
  await joinChannel(db, { channelId: ch.id, userId: "user-svc-member4" });
  await leaveChannel(db, { channelId: ch.id, userId: "user-svc-member4" });

  const memberRows = await db
    .select()
    .from(channelMembers)
    .where(eq(channelMembers.channelId, ch.id));
  expect(memberRows.map((r) => r.userId)).not.toContain("user-svc-member4");
});

test("archiveChannel and restoreChannel toggle archivedAt", async () => {
  const db = getDb(env.DB);
  const ch = await createChannel(db, {
    teamId: "team-svc-ch-arch",
    name: "general",
    displayName: "General",
    type: "public",
    creatorId: "user-svc-1",
  });
  expect(ch.archivedAt).toBeNull();
  await archiveChannel(db, { channelId: ch.id });
  expect(await archivedAtOf(ch.id)).toBeTruthy();
  await restoreChannel(db, { channelId: ch.id });
  expect(await archivedAtOf(ch.id)).toBeNull();
});

async function archivedAtOf(channelId: string): Promise<number | null> {
  const rows = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  return rows[0]?.archivedAt ?? null;
}
