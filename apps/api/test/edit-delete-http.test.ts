import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { channelDoName } from "protocol";

let author = "";
let member = "";
let outsider = "";
let channelId = "";
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

function channelStub() {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
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
  channelId = ((await create.json()) as { id: string }).id;
  await exports.default.fetch(`http://localhost/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/members`, {
    method: "POST",
    headers: { cookie: member },
  });
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie: author },
  });
  authorUserId = ((await me.json()) as { user: { id: string } }).user.id;
  const stub = channelStub();
  await stub.membersAdd({ userId: authorUserId, role: "member" });
  const post = await stub.postMessage(authorUserId, {
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
    body: JSON.stringify({ message: "edited via http", channelId }),
  });
  expect(res.status).toBe(200);
  const hist = await channelStub().history({ limit: 10 });
  const target = hist.messages.find((m) => m.id === messageId)!;
  expect(target.content).toBe("edited via http");
  expect(target.editedAt).not.toBeNull();
});

test("non-author edit returns 403", async () => {
  const res = await exports.default.fetch(`http://localhost/api/v1/posts/${messageId}/patch`, {
    method: "PUT",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({ message: "hijacked", channelId }),
  });
  expect(res.status).toBe(403);
});

test("author delete returns ok and history reflects deletedAt", async () => {
  const res = await exports.default.fetch(`http://localhost/api/v1/posts/${messageId}`, {
    method: "DELETE",
    headers: { cookie: author, "content-type": "application/json" },
    body: JSON.stringify({ channelId }),
  });
  expect(res.status).toBe(200);
  const hist = await channelStub().history({ limit: 10 });
  const target = hist.messages.find((m) => m.id === messageId)!;
  expect(target.deletedAt).not.toBeNull();
  expect(target.content).toBe("");
});

test("invalid content rejected with 422", async () => {
  const res = await exports.default.fetch(`http://localhost/api/v1/posts/${messageId}/patch`, {
    method: "PUT",
    headers: { cookie: author, "content-type": "application/json" },
    body: JSON.stringify({ message: "", channelId }),
  });
  expect(res.status).toBe(422);
});

test("non-member edit and delete return 403", async () => {
  const edit = await exports.default.fetch(`http://localhost/api/v1/posts/${messageId}/patch`, {
    method: "PUT",
    headers: { cookie: outsider, "content-type": "application/json" },
    body: JSON.stringify({ message: "nope", channelId }),
  });
  expect(edit.status).toBe(403);
  const del = await exports.default.fetch(`http://localhost/api/v1/posts/${messageId}`, {
    method: "DELETE",
    headers: { cookie: outsider, "content-type": "application/json" },
    body: JSON.stringify({ channelId }),
  });
  expect(del.status).toBe(403);
});
