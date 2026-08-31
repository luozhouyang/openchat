import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";

let memberCookie = "";
let outsiderCookie = "";
let partialCookie = "";
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

async function createChannel(
  cookie: string,
  name: string,
): Promise<{ id: string; teamId: string }> {
  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: `team-${name}`, display_name: `Team ${name}`, type: "open" }),
  });
  const teamId = ((await team.json()) as { id: string }).id;
  const ch = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ team_id: teamId, name, display_name: name, type: "public" }),
  });
  return { id: ((await ch.json()) as { id: string }).id, teamId };
}

async function uploadFile(cookie: string, targetChannelId: string, filename: string) {
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
  const key = `uploads/${targetChannelId}/${uploadId}/${filename}`;
  await env.FILES.put(key, new Uint8Array(1024), { httpMetadata: { contentType: "image/png" } });
  const complete = await exports.default.fetch(
    `http://localhost/api/v1/uploads/${uploadId}/complete`,
    { method: "POST", headers: { cookie, "content-type": "application/json" } },
  );
  expect(complete.status).toBe(201);
  return uploadId;
}

beforeAll(async () => {
  memberCookie = await signup("filer@test.dev");
  outsiderCookie = await signup("file-outsider@test.dev");
  partialCookie = await signup("file-partial@test.dev");
  const ch1 = await createChannel(memberCookie, "docs");
  channelId = ch1.id;
  const ch2 = await createChannel(memberCookie, "media");
  otherChannelId = ch2.id;
  await exports.default.fetch(`http://localhost/api/v1/teams/${ch1.teamId}/members`, {
    method: "POST",
    headers: { cookie: partialCookie, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/members`, {
    method: "POST",
    headers: { cookie: partialCookie },
  });
});

test("download requires session", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/files/any", {
    redirect: "manual",
  });
  expect(res.status).toBe(401);
});

test("non-member download rejected", async () => {
  const uploadId = await uploadFile(memberCookie, channelId, "any.png");
  const res = await exports.default.fetch(`http://localhost/api/v1/files/${uploadId}`, {
    headers: { cookie: outsiderCookie },
    redirect: "manual",
  });
  expect(res.status).toBe(403);
});

test("member download redirects to presigned url", async () => {
  const uploadId = await uploadFile(memberCookie, channelId, "report.png");
  const res = await exports.default.fetch(`http://localhost/api/v1/files/${uploadId}`, {
    headers: { cookie: memberCookie },
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  const location = res.headers.get("location") ?? "";
  expect(location).toContain("X-Amz-Signature");
  expect(location).toContain(`uploads/${channelId}/${uploadId}/report.png`);
});

test("non-member of the file's channel rejected", async () => {
  const uploadId = await uploadFile(memberCookie, otherChannelId, "secret.png");
  const res = await exports.default.fetch(`http://localhost/api/v1/files/${uploadId}`, {
    headers: { cookie: partialCookie },
    redirect: "manual",
  });
  expect(res.status).toBe(403);
});

test("member download of missing file not found", async () => {
  const res = await exports.default.fetch(`http://localhost/api/v1/files/no-such-id`, {
    headers: { cookie: memberCookie },
    redirect: "manual",
  });
  expect(res.status).toBe(404);
});
