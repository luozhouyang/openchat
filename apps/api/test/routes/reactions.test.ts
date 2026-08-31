import { expect, test, beforeAll } from "vite-plus/test";
import { exports } from "cloudflare:workers";

let owner = "";
let member = "";
let outsider = "";
let teamId = "";
let channelId = "";
let memberUserId = "";
let postId = "";

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "reactions-test-password",
      name: email.split("@")[0],
    }),
  });
  return res.headers.get("set-cookie") ?? "";
}

beforeAll(async () => {
  owner = await signup("reacts-owner@test.dev");
  member = await signup("reacts-member@test.dev");
  outsider = await signup("reacts-outsider@test.dev");
  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: owner, "content-type": "application/json" },
    body: JSON.stringify({ name: "reactsco", display_name: "ReactsCo", type: "open" }),
  });
  teamId = ((await team.json()) as { id: string }).id;
  const create = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: owner, "content-type": "application/json" },
    body: JSON.stringify({
      team_id: teamId,
      name: "reacts",
      display_name: "Reacts",
      type: "public",
    }),
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
    headers: { cookie: member },
  });
  memberUserId = ((await me.json()) as { user: { id: string } }).user.id;
  const post = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/posts`, {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({ message: "react to me", client_token: "reacts-post-1" }),
  });
  postId = ((await post.json()) as { id: string }).id;
});

test("reaction adds and toggles off", async () => {
  const add = await exports.default.fetch("http://localhost/api/v1/reactions", {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({ post_id: postId, emoji_name: "👍", channel_id: channelId }),
  });
  expect(add.status).toBe(200);
  expect(await add.json()).toEqual({ ok: true });

  const after = await exports.default.fetch(
    `http://localhost/api/v1/posts/${postId}/reactions?channel_id=${channelId}`,
    { headers: { cookie: member } },
  );
  expect(after.status).toBe(200);
  const body = (await after.json()) as { reactions: Record<string, string[]> };
  expect(body.reactions["👍"]).toContain(memberUserId);

  const remove = await exports.default.fetch("http://localhost/api/v1/reactions", {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({ post_id: postId, emoji_name: "👍", channel_id: channelId }),
  });
  expect(remove.status).toBe(200);

  const afterToggle = await exports.default.fetch(
    `http://localhost/api/v1/posts/${postId}/reactions?channel_id=${channelId}`,
    { headers: { cookie: member } },
  );
  const afterBody = (await afterToggle.json()) as { reactions: Record<string, string[]> };
  expect(afterBody.reactions["👍"] ?? []).not.toContain(memberUserId);
});

test("invalid emoji rejected with 422", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/reactions", {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({ post_id: postId, emoji_name: "not-an-emoji", channel_id: channelId }),
  });
  expect(res.status).toBe(422);
});

test("non-member reaction rejected with 403", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/reactions", {
    method: "POST",
    headers: { cookie: outsider, "content-type": "application/json" },
    body: JSON.stringify({ post_id: postId, emoji_name: "👍", channel_id: channelId }),
  });
  expect(res.status).toBe(403);
});

test("reaction on missing post returns 404", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/reactions", {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({ post_id: "missing-post", emoji_name: "👍", channel_id: channelId }),
  });
  expect(res.status).toBe(404);
});

test("delete reaction removes only own reaction", async () => {
  const add = await exports.default.fetch("http://localhost/api/v1/reactions", {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({ post_id: postId, emoji_name: "🔥", channel_id: channelId }),
  });
  expect(add.status).toBe(200);

  const del = await exports.default.fetch(
    `http://localhost/api/v1/users/me/posts/${postId}/reactions/${encodeURIComponent("🔥")}?channel_id=${channelId}`,
    { method: "DELETE", headers: { cookie: member } },
  );
  expect(del.status).toBe(200);

  const snap = await exports.default.fetch(
    `http://localhost/api/v1/posts/${postId}/reactions?channel_id=${channelId}`,
    { headers: { cookie: member } },
  );
  const body = (await snap.json()) as { reactions: Record<string, string[]> };
  expect(body.reactions["🔥"] ?? []).not.toContain(memberUserId);
});

test("deleting a reaction that is not present returns 404", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/users/me/posts/${postId}/reactions/${encodeURIComponent("✅")}?channel_id=${channelId}`,
    { method: "DELETE", headers: { cookie: member } },
  );
  expect(res.status).toBe(404);
});
