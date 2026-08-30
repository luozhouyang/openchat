import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";

let memberCookie = "";
let outsiderCookie = "";
let channelId = "";
let otherChannelId = "";

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "files-test-password", name: email.split("@")[0] }),
  });
  return res.headers.get("set-cookie") ?? "";
}

async function createChannel(cookie: string, name: string): Promise<string> {
  const team = await exports.default.fetch("http://localhost/teams", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: `team-${name}`, displayName: `Team ${name}`, type: "open" }),
  });
  const teamId = ((await team.json()) as { id: string }).id;
  const ch = await exports.default.fetch(`http://localhost/teams/${teamId}/channels`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name, displayName: name, type: "public" }),
  });
  return ((await ch.json()) as { id: string }).id;
}

async function uploadFile(cookie: string, targetChannelId: string, filename: string) {
  const create = await exports.default.fetch("http://localhost/uploads", {
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
  const key = `uploads/${targetChannelId}/${uploadId}/${filename}`;
  await env.FILES.put(key, new Uint8Array(1024), { httpMetadata: { contentType: "image/png" } });
  const complete = await exports.default.fetch("http://localhost/uploads/complete", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ uploadId }),
  });
  expect(complete.status).toBe(201);
  return uploadId;
}

beforeAll(async () => {
  memberCookie = await signup("filer@test.dev");
  outsiderCookie = await signup("file-outsider@test.dev");
  channelId = await createChannel(memberCookie, "docs");
  otherChannelId = await createChannel(memberCookie, "media");
});

test("download requires session", async () => {
  const res = await exports.default.fetch("http://localhost/files/any/any", {
    redirect: "manual",
  });
  expect(res.status).toBe(401);
});

test("non-member download rejected", async () => {
  const res = await exports.default.fetch(`http://localhost/files/${channelId}/any`, {
    headers: { cookie: outsiderCookie },
    redirect: "manual",
  });
  expect(res.status).toBe(403);
});

test("member download redirects to presigned url", async () => {
  const uploadId = await uploadFile(memberCookie, channelId, "report.png");
  const res = await exports.default.fetch(`http://localhost/files/${channelId}/${uploadId}`, {
    headers: { cookie: memberCookie },
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  const location = res.headers.get("location") ?? "";
  expect(location).toContain("X-Amz-Signature");
  expect(location).toContain(`uploads/${channelId}/${uploadId}/report.png`);
});

test("member cannot download file from another channel", async () => {
  const uploadId = await uploadFile(memberCookie, channelId, "secret.png");
  const res = await exports.default.fetch(`http://localhost/files/${otherChannelId}/${uploadId}`, {
    headers: { cookie: memberCookie },
    redirect: "manual",
  });
  expect(res.status).toBe(404);
});

test("member download of missing file not found", async () => {
  const res = await exports.default.fetch(`http://localhost/files/${channelId}/no-such-id`, {
    headers: { cookie: memberCookie },
    redirect: "manual",
  });
  expect(res.status).toBe(404);
});
