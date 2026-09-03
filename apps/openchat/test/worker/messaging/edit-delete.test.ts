import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { channelDoName } from "protocol";

const stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName("c-ed")));
let msgId = "";
let adminMsgId = "";

beforeAll(async () => {
  await stub.membersAdd({ userId: "alice", role: "member" });
  await stub.membersAdd({ userId: "bob", role: "member" });
  await stub.membersAdd({ userId: "carol", role: "channel_admin" });
  const post = await stub.postMessage("alice", { content: "original", clientToken: "ed-msg" });
  if ("error" in post) throw new Error(post.error);
  msgId = post.messageId;
  const post2 = await stub.postMessage("bob", { content: "bob's", clientToken: "ed-msg2" });
  if ("error" in post2) throw new Error(post2.error);
  adminMsgId = post2.messageId;
});

test("author can edit, non-author cannot", async () => {
  expect(await stub.editMessage("alice", { messageId: msgId, content: "edited" })).toEqual({
    ok: true,
  });
  expect(await stub.editMessage("bob", { messageId: msgId, content: "hacked" })).toEqual({
    error: "forbidden",
    status: 403,
  });
  const hist = await stub.history({ limit: 10 });
  const target = hist.messages.find((m) => m.id === msgId)!;
  expect(target.content).toBe("edited");
  expect(target.editedAt).not.toBeNull();
});

test("empty content rejected", async () => {
  expect(await stub.editMessage("alice", { messageId: msgId, content: "" })).toEqual({
    error: "invalid",
    status: 422,
  });
});

test("admin can edit another author's message", async () => {
  expect(await stub.editMessage("carol", { messageId: adminMsgId, content: "by admin" })).toEqual({
    ok: true,
  });
  expect(await stub.deleteMessage("carol", { messageId: adminMsgId })).toEqual({ ok: true });
});

test("delete soft-deletes and clears content in history", async () => {
  expect(await stub.deleteMessage("alice", { messageId: msgId })).toEqual({ ok: true });
  const hist = await stub.history({ limit: 10 });
  const target = hist.messages.find((m) => m.id === msgId)!;
  expect(target.deletedAt).not.toBeNull();
  expect(target.content).toBe("");
  expect(await stub.deleteMessage("alice", { messageId: msgId })).toEqual({ ok: true });
});

test("edit/delete on missing message returns not found", async () => {
  expect(await stub.editMessage("alice", { messageId: "missing-msg", content: "x" })).toEqual({
    error: "not found",
    status: 404,
  });
  expect(await stub.deleteMessage("alice", { messageId: "missing-msg" })).toEqual({
    error: "not found",
    status: 404,
  });
});

test("editing a deleted message returns gone", async () => {
  expect(await stub.editMessage("alice", { messageId: msgId, content: "again" })).toEqual({
    error: "deleted",
    status: 410,
  });
});

let author = "";
let member = "";
let outsider = "";
let httpChannelId = "";
let authorUserId = "";
let messageId = "";

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "edit-delete-http-password",
      name: email.split("@")[0],
    }),
  });
  return res.headers.get("set-cookie") ?? "";
}

function httpChannelStub() {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(httpChannelId)));
}

beforeAll(async () => {
  author = await signup("ed-author@test.dev");
  member = await signup("ed-member@test.dev");
  outsider = await signup("ed-outsider@test.dev");
  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: author, "content-type": "application/json" },
    body: JSON.stringify({ name: "edco", displayName: "EdCo", type: "open" }),
  });
  const teamId = ((await team.json()) as { id: string }).id;
  const create = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: author, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name: "ed", displayName: "Ed", type: "public" }),
  });
  httpChannelId = ((await create.json()) as { id: string }).id;
  await exports.default.fetch(`http://localhost/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  await exports.default.fetch(`http://localhost/api/v1/channels/${httpChannelId}/members`, {
    method: "POST",
    headers: { cookie: member },
  });
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie: author },
  });
  authorUserId = ((await me.json()) as { user: { id: string } }).user.id;
  const httpStub = httpChannelStub();
  await httpStub.membersAdd({ userId: authorUserId, role: "member" });
  const post = await httpStub.postMessage(authorUserId, {
    content: "original",
    clientToken: "ed-http-1",
  });
  if ("error" in post) throw new Error(post.error);
  messageId = post.messageId;
});

test("author edit returns ok and history reflects new content", async () => {
  const res = await exports.default.fetch(`http://localhost/api/v1/posts/${messageId}/patch`, {
    method: "PUT",
    headers: { cookie: author, "content-type": "application/json" },
    body: JSON.stringify({ message: "edited via http", channelId: httpChannelId }),
  });
  expect(res.status).toBe(200);
  const hist = await httpChannelStub().history({ limit: 10 });
  const target = hist.messages.find((m) => m.id === messageId)!;
  expect(target.content).toBe("edited via http");
  expect(target.editedAt).not.toBeNull();
});

test("non-author edit returns 403", async () => {
  const res = await exports.default.fetch(`http://localhost/api/v1/posts/${messageId}/patch`, {
    method: "PUT",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({ message: "hijacked", channelId: httpChannelId }),
  });
  expect(res.status).toBe(403);
});

test("author delete returns ok and history reflects deletedAt", async () => {
  const res = await exports.default.fetch(`http://localhost/api/v1/posts/${messageId}`, {
    method: "DELETE",
    headers: { cookie: author, "content-type": "application/json" },
    body: JSON.stringify({ channelId: httpChannelId }),
  });
  expect(res.status).toBe(200);
  const hist = await httpChannelStub().history({ limit: 10 });
  const target = hist.messages.find((m) => m.id === messageId)!;
  expect(target.deletedAt).not.toBeNull();
  expect(target.content).toBe("");
});

test("invalid content rejected with 422", async () => {
  const res = await exports.default.fetch(`http://localhost/api/v1/posts/${messageId}/patch`, {
    method: "PUT",
    headers: { cookie: author, "content-type": "application/json" },
    body: JSON.stringify({ message: "", channelId: httpChannelId }),
  });
  expect(res.status).toBe(422);
});

test("non-member edit and delete return 403", async () => {
  const edit = await exports.default.fetch(`http://localhost/api/v1/posts/${messageId}/patch`, {
    method: "PUT",
    headers: { cookie: outsider, "content-type": "application/json" },
    body: JSON.stringify({ message: "nope", channelId: httpChannelId }),
  });
  expect(edit.status).toBe(403);
  const del = await exports.default.fetch(`http://localhost/api/v1/posts/${messageId}`, {
    method: "DELETE",
    headers: { cookie: outsider, "content-type": "application/json" },
    body: JSON.stringify({ channelId: httpChannelId }),
  });
  expect(del.status).toBe(403);
});
