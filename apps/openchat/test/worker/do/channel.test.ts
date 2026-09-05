import { env, exports } from "cloudflare:workers";
import { expect, test, beforeAll } from "vite-plus/test";
import { channelDoName } from "protocol";

type ChannelStub = ReturnType<typeof env.CHANNEL_DO.get>;

let ownerCookie = "";
let memberACookie = "";
let memberBCookie = "";
let ownerId = "";
let memberAId = "";
let memberBId = "";
let channelId = "";
let stub: ChannelStub;
let rootId = "";
let rootSeq = 0;

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "td1-test-password",
      name: email.split("@")[0],
      username: email.split("@")[0],
    }),
  });
  return res.headers.get("set-cookie") ?? "";
}

async function userIdOf(cookie: string): Promise<string> {
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie },
  });
  return ((await me.json()) as { user: { id: string } }).user.id;
}

async function createChannel(): Promise<string> {
  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "td1", displayName: "Task D1", type: "open" }),
  });
  const teamId = ((await team.json()) as { id: string }).id;
  for (const cookie of [memberACookie, memberBCookie]) {
    await exports.default.fetch(`http://localhost/api/v1/teams/${teamId}/members`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
  }
  const create = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name: "d1", displayName: "D1", type: "public" }),
  });
  expect(create.status).toBe(201);
  const id = ((await create.json()) as { id: string }).id;
  for (const cookie of [memberACookie, memberBCookie]) {
    const join = await exports.default.fetch(`http://localhost/api/v1/channels/${id}/members`, {
      method: "POST",
      headers: { cookie },
    });
    expect(join.status).toBe(200);
  }
  return id;
}

beforeAll(async () => {
  ownerCookie = await signup("td1-owner@test.dev");
  memberACookie = await signup("td1-a@test.dev");
  memberBCookie = await signup("td1-b@test.dev");
  ownerId = await userIdOf(ownerCookie);
  memberAId = await userIdOf(memberACookie);
  memberBId = await userIdOf(memberBCookie);
  channelId = await createChannel();
  stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
  await stub.membersAdd({ userId: ownerId, role: "channel_admin" });
  const post = await stub.postMessage(ownerId, { content: "root post", clientToken: "td1-root" });
  if ("error" in post) {
    throw new Error(post.error);
  }
  rootId = post.messageId;
  rootSeq = post.seq;
});

test("replies build thread row with replyCount and participants", async () => {
  const r1 = await stub.postMessage(memberAId, {
    content: "reply one",
    parentId: rootId,
    clientToken: "td1-r1",
  });
  expect(r1).not.toHaveProperty("error");
  const r2 = await stub.postMessage(memberBId, {
    content: "reply two",
    parentId: rootId,
    clientToken: "td1-r2",
  });
  expect(r2).not.toHaveProperty("error");

  const res = await stub.getThread(rootId);
  if ("error" in res) {
    throw new Error(res.error);
  }
  expect(res.thread.replyCount).toBe(2);
  expect(res.thread.participants).toEqual([memberAId, memberBId]);
  expect(res.thread.channelId).toBe(channelId);
});

test("thread row for unknown post is 404", async () => {
  const res = await stub.getThread("does-not-exist");
  expect(res).toEqual({ error: "not found", status: 404 });
});

test("reaction add/remove toggles hasReactions on the message", async () => {
  const before = (await stub.history({ limit: 50 })).messages.find((m) => m.id === rootId);
  expect(before?.hasReactions).toBe(false);

  expect(
    await stub.toggleReaction(memberAId, { messageSeq: rootSeq, emoji: "👍" }),
  ).toBeUndefined();
  expect(await stub.reactionSnapshot(rootSeq)).toEqual({ "👍": [memberAId] });
  const afterAdd = (await stub.history({ limit: 50 })).messages.find((m) => m.id === rootId);
  expect(afterAdd?.hasReactions).toBe(true);

  expect(
    await stub.toggleReaction(memberAId, { messageSeq: rootSeq, emoji: "👍" }),
  ).toBeUndefined();
  expect(await stub.reactionSnapshot(rootSeq)).toEqual({});
  const afterRemove = (await stub.history({ limit: 50 })).messages.find((m) => m.id === rootId);
  expect(afterRemove?.hasReactions).toBe(false);
});

test("toggleReactionByMessageId resolves by message id", async () => {
  expect(
    await stub.toggleReactionByMessageId(memberBId, { messageId: rootId, emoji: "❤️" }),
  ).toBeUndefined();
  expect(await stub.reactionSnapshot(rootSeq)).toEqual({ "❤️": [memberBId] });
  expect(
    await stub.toggleReactionByMessageId(memberBId, { messageId: rootId, emoji: "❤️" }),
  ).toBeUndefined();
  expect(await stub.reactionSnapshot(rootSeq)).toEqual({});
  const missing = await stub.toggleReactionByMessageId(memberBId, {
    messageId: "nope",
    emoji: "❤️",
  });
  expect(missing).toEqual({ error: "message not found", status: 404 });
});

test("pinMessage by non-author non-admin is forbidden", async () => {
  const res = await stub.pinMessage(memberBId, { messageId: rootId, pinned: true });
  expect(res).toEqual({ error: "forbidden", status: 403 });
});

test("pinMessage by channel_admin succeeds and flips isPinned", async () => {
  await stub.membersAdd({ userId: memberAId, role: "channel_admin" });
  const res = await stub.pinMessage(memberAId, { messageId: rootId, pinned: true });
  expect(res).toEqual({ ok: true });
  const pinned = (await stub.history({ limit: 50 })).messages.find((m) => m.id === rootId);
  expect(pinned?.isPinned).toBe(true);
  expect(pinned?.updatedAt).toBeGreaterThan(0);

  const unpin = await stub.pinMessage(memberAId, { messageId: rootId, pinned: false });
  expect(unpin).toEqual({ ok: true });
});

test("pinMessage on missing message is 404", async () => {
  const res = await stub.pinMessage(ownerId, { messageId: "nope", pinned: true });
  expect(res).toEqual({ error: "not found", status: 404 });
});

test("message author can pin own message without admin", async () => {
  const own = await stub.postMessage(memberBId, { content: "own pin", clientToken: "td1-pin" });
  if ("error" in own) {
    throw new Error(own.error);
  }
  const res = await stub.pinMessage(memberBId, { messageId: own.messageId, pinned: true });
  expect(res).toEqual({ ok: true });
});

test("channel_user cannot edit or delete another member's message", async () => {
  await stub.membersAdd({ userId: memberBId, role: "channel_user" });
  expect(await stub.editMessage(memberBId, { messageId: rootId, content: "hacked" })).toEqual({
    error: "forbidden",
    status: 403,
  });
  expect(await stub.deleteMessage(memberBId, { messageId: rootId })).toEqual({
    error: "forbidden",
    status: 403,
  });
});

test("channel_admin can edit and delete another member's message", async () => {
  const victim = await stub.postMessage(memberBId, {
    content: "victim message",
    clientToken: "td1-admin-edit",
  });
  if ("error" in victim) {
    throw new Error(victim.error);
  }
  await stub.membersAdd({ userId: memberAId, role: "channel_admin" });
  expect(
    await stub.editMessage(memberAId, { messageId: victim.messageId, content: "edited by admin" }),
  ).toEqual({ ok: true });
  expect(await stub.deleteMessage(memberAId, { messageId: victim.messageId })).toEqual({
    ok: true,
  });
  const hist = (await stub.history({ limit: 50 })).messages.find((m) => m.id === victim.messageId);
  expect(hist?.deletedAt).not.toBeNull();
});
