import { env, exports } from "cloudflare:workers";
import { expect, test, beforeAll } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { getDb } from "@worker/db/client";
import { users } from "@worker/db/schema-d1";

let owner = "";
let member = "";
let other = "";
let ownerId = "";
let teamId = "";
let channelId = "";
let memberId = "";
let otherId = "";
let postId = "";

async function signup(email: string): Promise<{ cookie: string; id: string }> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "kick-test-password",
      name: email.split("@")[0],
      username: email.split("@")[0],
    }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie },
  });
  const { user } = (await me.json()) as { user: { id: string } };
  return { cookie, id: user.id };
}

function join(channelId: string, cookie: string): Promise<Response> {
  return exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/members`, {
    method: "POST",
    headers: { cookie },
  });
}

beforeAll(async () => {
  const o = await signup("kick-owner@test.dev");
  owner = o.cookie;
  ownerId = o.id;
  const m = await signup("kick-member@test.dev");
  member = m.cookie;
  memberId = m.id;
  const x = await signup("kick-other@test.dev");
  other = x.cookie;
  otherId = x.id;

  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: owner, "content-type": "application/json" },
    body: JSON.stringify({ name: "kickco", displayName: "KickCo", type: "open" }),
  });
  teamId = ((await team.json()) as { id: string }).id;
  await exports.default.fetch(`http://localhost/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  await exports.default.fetch(`http://localhost/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: { cookie: other, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  const create = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: owner, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name: "kickable", displayName: "Kickable", type: "public" }),
  });
  channelId = ((await create.json()) as { id: string }).id;
  await join(channelId, member);
  await join(channelId, other);
  const post = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/posts`, {
    method: "POST",
    headers: { cookie: other, "content-type": "application/json" },
    body: JSON.stringify({ message: "kick me note", clientToken: "kick-post-1" }),
  });
  postId = ((await post.json()) as { id: string }).id;
});

test("member kicked by channel admin leaves the member list", async () => {
  const before = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/members`,
    {
      headers: { cookie: owner },
    },
  );
  const beforeIds = ((await before.json()) as { memberIds: string[] }).memberIds;
  expect(beforeIds).toContain(memberId);

  const del = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/members/${memberId}`,
    { method: "DELETE", headers: { cookie: owner } },
  );
  expect(del.status).toBe(200);

  const after = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/members`,
    {
      headers: { cookie: owner },
    },
  );
  expect(((await after.json()) as { memberIds: string[] }).memberIds).not.toContain(memberId);
});

test("plain member cannot kick others", async () => {
  const rejoin = await join(channelId, member);
  expect(rejoin.status).toBe(200);
  const attempt = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/members/${otherId}`,
    { method: "DELETE", headers: { cookie: member } },
  );
  expect(attempt.status).toBe(403);
});

test("self-leave still works", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/members/${memberId}`,
    { method: "DELETE", headers: { cookie: member } },
  );
  expect(res.status).toBe(200);
  const after = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/members`,
    {
      headers: { cookie: owner },
    },
  );
  expect(((await after.json()) as { memberIds: string[] }).memberIds).not.toContain(memberId);
});

test("admin-delete targets the right user's reaction (not the caller's)", async () => {
  // member reacts with 🔥. The route allows self-deletion or a system admin
  // (users.role === "admin"); promote the owner to a system admin and have
  // them remove the member's reaction — the old code deleted the CALLER's row.
  await getDb(env.DB).update(users).set({ role: "admin" }).where(eq(users.id, ownerId));

  await join(channelId, member); // member self-left in the previous test
  const react = await exports.default.fetch("http://localhost/api/v1/reactions", {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({ postId, emojiName: "🔥", channelId }),
  });
  expect(react.status).toBe(200);

  const del = await exports.default.fetch(
    `http://localhost/api/v1/users/${memberId}/posts/${postId}/reactions/${encodeURIComponent("🔥")}?channelId=${channelId}`,
    { method: "DELETE", headers: { cookie: owner } },
  );
  expect(del.status).toBe(200);

  const snap = await exports.default.fetch(
    `http://localhost/api/v1/posts/${postId}/reactions?channelId=${channelId}`,
    { headers: { cookie: other } },
  );
  const body = (await snap.json()) as { reactions: Record<string, string[]> };
  expect(body.reactions["🔥"] ?? []).not.toContain(memberId);
});

test("member cannot delete another member's reaction", async () => {
  await join(channelId, member);
  const reactOther = await exports.default.fetch("http://localhost/api/v1/reactions", {
    method: "POST",
    headers: { cookie: other, "content-type": "application/json" },
    body: JSON.stringify({ postId, emojiName: "👍", channelId }),
  });
  expect(reactOther.status).toBe(200);

  const del = await exports.default.fetch(
    `http://localhost/api/v1/users/${otherId}/posts/${postId}/reactions/${encodeURIComponent("👍")}?channelId=${channelId}`,
    { method: "DELETE", headers: { cookie: member } },
  );
  expect(del.status).toBe(403);

  const snap = await exports.default.fetch(
    `http://localhost/api/v1/posts/${postId}/reactions?channelId=${channelId}`,
    { headers: { cookie: other } },
  );
  const body = (await snap.json()) as { reactions: Record<string, string[]> };
  expect(body.reactions["👍"]).toContain(otherId);
});
