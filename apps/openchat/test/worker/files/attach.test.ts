import { env, exports } from "cloudflare:workers";
import { beforeAll, expect, test } from "vite-plus/test";

async function signup(email: string, password: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      name: email.split("@")[0],
      username: email.split("@")[0],
    }),
  });
  return res.headers.get("set-cookie") ?? "";
}

async function createTeamChannel(
  cookie: string,
  teamName: string,
  channelName: string,
): Promise<string> {
  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: teamName, displayName: teamName, type: "open" }),
  });
  const teamId = ((await team.json()) as { id: string }).id;
  const channel = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name: channelName, displayName: channelName, type: "public" }),
  });
  return ((await channel.json()) as { id: string }).id;
}

let ownerCookie = "";
let outsiderCookie = "";
let channelId = "";
let otherChannelId = "";

async function startUpload(cookie: string, targetChannelId: string, filename: string) {
  const create = await exports.default.fetch("http://localhost/api/v1/uploads", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      channelId: targetChannelId,
      filename,
      size: 1024,
      contentType: "image/png",
    }),
  });
  const { uploadId } = (await create.json()) as { uploadId: string };
  await env.FILES.put(`uploads/${targetChannelId}/${uploadId}/${filename}`, new Uint8Array(1024), {
    httpMetadata: { contentType: "image/png" },
  });
  return uploadId;
}

async function attach(cookie: string, uploadId: string) {
  const res = await exports.default.fetch(`http://localhost/api/v1/uploads/${uploadId}/attach`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
  });
  return {
    status: res.status,
    body: (await res.json()) as { attachment?: { fileId: string; name: string; mime: string } },
  };
}

async function listPosts(cookie: string): Promise<Array<{ id: string; attachments?: unknown[] }>> {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/posts?limit=50`,
    { headers: { cookie } },
  );
  const body = (await res.json()) as { messages: Array<{ id: string; attachments?: unknown[] }> };
  return body.messages;
}

beforeAll(async () => {
  ownerCookie = await signup("attach-owner@test.dev", "attach-test-password");
  outsiderCookie = await signup("attach-outsider@test.dev", "attach-test-password");
  channelId = await createTeamChannel(ownerCookie, "attach-team", "attach");
  otherChannelId = await createTeamChannel(ownerCookie, "attach-other", "other");
});

test("attach finishes the upload without posting a message", async () => {
  const uploadId = await startUpload(ownerCookie, channelId, "draft.png");
  const { status, body } = await attach(ownerCookie, uploadId);
  expect(status).toBe(201);
  expect(body.attachment).toMatchObject({ fileId: uploadId, name: "draft.png", mime: "image/png" });
  expect(await listPosts(ownerCookie)).toHaveLength(0);
});

test("posting a draft attachment stores and links the file", async () => {
  const uploadId = await startUpload(ownerCookie, channelId, "linked.png");
  const attached = await attach(ownerCookie, uploadId);
  const res = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/posts`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ message: "", attachments: [attached.body.attachment] }),
  });
  expect(res.status).toBe(201);
  const post = (await res.json()) as { id: string; attachments?: Array<{ fileId: string }> };
  expect(post.attachments?.[0]?.fileId).toBe(uploadId);

  const info = await exports.default.fetch(`http://localhost/api/v1/files/${uploadId}/info`, {
    headers: { cookie: ownerCookie },
  });
  expect(((await info.json()) as { postId: string }).postId).toBe(post.id);
});

test("attaching someone else's upload is forbidden", async () => {
  const uploadId = await startUpload(ownerCookie, channelId, "mine.png");
  const { status } = await attach(outsiderCookie, uploadId);
  expect(status).toBe(403);
});

test("posting an attachment from another channel is forbidden", async () => {
  const uploadId = await startUpload(ownerCookie, otherChannelId, "elsewhere.png");
  const attached = await attach(ownerCookie, uploadId);
  const res = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/posts`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ message: "hi", attachments: [attached.body.attachment] }),
  });
  expect(res.status).toBe(403);
});

test("an empty post without attachments is rejected", async () => {
  const res = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/posts`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ message: "" }),
  });
  expect(res.status).toBe(422);
});
