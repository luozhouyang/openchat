import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { userDoName } from "protocol";
import { getDb } from "../../src/db/client.ts";
import { channels } from "../../src/db/schema-d1.ts";

interface Category {
  id: string;
  userId: string;
  teamId: string | null;
  sortOrder: number | null;
  sorting: string | null;
  type: string | null;
  displayName: string | null;
  muted: boolean;
  collapsed: boolean;
  channels: {
    channelId: string;
    sortOrder: number;
    unread: number;
    mentions: number;
    preview: string | null;
    lastMessageAt: number | null;
  }[];
}

let userId = "";
let otherUserId = "";

function userStub(uid: string) {
  return env.USER_DO.get(env.USER_DO.idFromName(userDoName(uid)));
}

async function signup(email: string): Promise<{ cookie: string; userId: string }> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "user-do-test-password", name: email.split("@")[0] }),
  });
  const c = res.headers.get("set-cookie") ?? "";
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie: c },
  });
  return { cookie: c, userId: ((await me.json()) as { user: { id: string } }).user.id };
}

async function sidebarCategories(uid: string): Promise<{ categories: Category[] }> {
  return userStub(uid).sidebarCategories(uid);
}

async function insertChannel(id: string, type: string): Promise<void> {
  await getDb(env.DB)
    .insert(channels)
    .values({
      id,
      teamId: null,
      name: null,
      displayName: type === "dm" ? "dm" : "General",
      type,
      dedupKey: null,
      archivedAt: null,
      creatorId: null,
      createdAt: Date.now(),
      header: null,
      purpose: null,
      lastPostAt: null,
      totalMsgCount: 0,
      totalMsgCountRoot: 0,
      lastRootPostAt: null,
      extraUpdateAt: null,
      schemeId: null,
      shared: false,
      groupConstrained: false,
      updatedAt: null,
    })
    .onConflictDoNothing();
}

beforeAll(async () => {
  ({ userId } = await signup("user-do@test.dev"));
  ({ userId: otherUserId } = await signup("user-do-other@test.dev"));
});

test("default sidebar categories are initialized", async () => {
  const { categories } = await sidebarCategories(userId);
  expect(categories).toHaveLength(3);
  expect(categories.map((c) => c.type).toSorted()).toEqual([
    "channels",
    "direct_messages",
    "favorite",
  ]);
  const channelsCat = categories.find((c) => c.type === "channels")!;
  const dmCat = categories.find((c) => c.type === "direct_messages")!;
  const favoritesCat = categories.find((c) => c.type === "favorite")!;
  expect(channelsCat.channels).toEqual([]);
  expect(dmCat.channels).toEqual([]);
  expect(favoritesCat.channels).toEqual([]);
});

test("channel added to channelsCache appears under the right category", async () => {
  const pubChannel = "c-pub";
  const dmChannel = "c-dm";
  await insertChannel(pubChannel, "public");
  await insertChannel(dmChannel, "dm");

  const stub = userStub(userId);
  await stub.channelsSubscribe([pubChannel, dmChannel]);

  const { categories } = await sidebarCategories(userId);
  const channelsCat = categories.find((c) => c.type === "channels")!;
  const dmCat = categories.find((c) => c.type === "direct_messages")!;

  const pub = channelsCat.channels.find((ch) => ch.channelId === pubChannel);
  expect(pub).toBeDefined();
  expect(pub!.unread).toBe(0);
  expect(pub!.mentions).toBe(0);
  expect(pub!.preview).toBeNull();
  expect(pub!.lastMessageAt).toBeNull();

  expect(dmCat.channels.map((ch) => ch.channelId)).toContain(dmChannel);
  expect(channelsCat.channels.map((ch) => ch.channelId)).not.toContain(dmChannel);
});

test("unresolvable channel falls back to channels category", async () => {
  const stub = userStub(otherUserId);
  await stub.channelsSubscribe(["c-unresolvable"]);
  const { categories } = await sidebarCategories(otherUserId);
  const channelsCat = categories.find((c) => c.type === "channels")!;
  expect(channelsCat.channels.map((ch) => ch.channelId)).toContain("c-unresolvable");
});

test("setStatus and getStatus round-trip", async () => {
  const stub = userStub(userId);
  const dndEndTime = Date.now() + 60 * 60 * 1000;
  await stub.setStatus(userId, { status: "dnd", manual: true, dndEndTime });
  const s = await stub.getStatus(userId);
  expect(s.status).toBe("dnd");
  expect(s.manual).toBe(true);
  expect(s.dndEndTime).toBe(dndEndTime);
  expect(s.userId).toBe(userId);

  await stub.setStatus(userId, { status: "offline", manual: false });
  const after = await stub.getStatus(userId);
  expect(after.status).toBe("offline");
  expect(after.manual).toBe(false);
});
