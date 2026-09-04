import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { channelDoName } from "protocol";

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
  teamDisplay: string,
  channelName: string,
  channelDisplay: string,
): Promise<{ id: string; teamId: string }> {
  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: teamName, displayName: teamDisplay, type: "open" }),
  });
  const teamId = ((await team.json()) as { id: string }).id;
  const ch = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      teamId,
      name: channelName,
      displayName: channelDisplay,
      type: "public",
    }),
  });
  return { id: ((await ch.json()) as { id: string }).id, teamId };
}

let memberCookie = "";
let outsiderCookie = "";
let partialCookie = "";
let fileChannelId = "";
let otherChannelId = "";

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
  memberCookie = await signup("filer@test.dev", "files-test-password");
  outsiderCookie = await signup("file-outsider@test.dev", "files-test-password");
  partialCookie = await signup("file-partial@test.dev", "files-test-password");
  const ch1 = await createTeamChannel(memberCookie, "team-docs", "Team docs", "docs", "docs");
  fileChannelId = ch1.id;
  const ch2 = await createTeamChannel(memberCookie, "team-media", "Team media", "media", "media");
  otherChannelId = ch2.id;
  await exports.default.fetch(`http://localhost/api/v1/teams/${ch1.teamId}/members`, {
    method: "POST",
    headers: { cookie: partialCookie, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  await exports.default.fetch(`http://localhost/api/v1/channels/${fileChannelId}/members`, {
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
  const uploadId = await uploadFile(memberCookie, fileChannelId, "any.png");
  const res = await exports.default.fetch(`http://localhost/api/v1/files/${uploadId}`, {
    headers: { cookie: outsiderCookie },
    redirect: "manual",
  });
  expect(res.status).toBe(403);
});

test("member download redirects to presigned url", async () => {
  const uploadId = await uploadFile(memberCookie, fileChannelId, "report.png");
  const res = await exports.default.fetch(`http://localhost/api/v1/files/${uploadId}`, {
    headers: { cookie: memberCookie },
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  const location = res.headers.get("location") ?? "";
  expect(location).toContain("X-Amz-Signature");
  expect(location).toContain(`uploads/${fileChannelId}/${uploadId}/report.png`);
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

test("file info returns camelCase fields for a member", async () => {
  const uploadId = await uploadFile(memberCookie, fileChannelId, "info.png");
  const res = await exports.default.fetch(`http://localhost/api/v1/files/${uploadId}/info`, {
    headers: { cookie: memberCookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    id: string;
    name: string;
    size: number;
    mimeType: string;
    extension: string;
    postId: string;
    createdAt: number;
  };
  expect(body.id).toBe(uploadId);
  expect(body.name).toBe("info.png");
  expect(body.mimeType).toBe("image/png");
  expect(body.postId).toBeTruthy();
  expect(typeof body.createdAt).toBe("number");
});

test("file info requires session", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/files/any/info");
  expect(res.status).toBe(401);
});

let ownerCookie = "";
let uploadOutsiderCookie = "";
let uploadChannelId = "";

async function requestUpload(cookie: string, overrides: Record<string, unknown> = {}) {
  const res = await exports.default.fetch("http://localhost/api/v1/uploads", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      channelId: uploadChannelId,
      filename: "pic.png",
      size: 1024,
      contentType: "image/png",
      ...overrides,
    }),
  });
  return { status: res.status, body: (await res.json()) as { uploadId?: string; putUrl?: string } };
}

async function completeUpload(
  uploadId: string,
): Promise<{ status: number; body: { messageId?: string } }> {
  const res = await exports.default.fetch(`http://localhost/api/v1/uploads/${uploadId}/complete`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
  });
  return { status: res.status, body: (await res.json()) as { messageId?: string } };
}

beforeAll(async () => {
  ownerCookie = await signup("upload-owner@test.dev", "upload-test-password");
  uploadOutsiderCookie = await signup("upload-outsider@test.dev", "upload-test-password");
  const ch = await createTeamChannel(ownerCookie, "upteam", "Up Team", "files", "Files");
  uploadChannelId = ch.id;
});

test("upload request returns presigned url for member", async () => {
  const res = await requestUpload(ownerCookie);
  expect(res.status).toBe(201);
  expect(res.body.putUrl).toContain("X-Amz-Signature");
});

test("non-member upload request rejected", async () => {
  const res = await requestUpload(uploadOutsiderCookie);
  expect(res.status).toBe(403);
});

test("oversized upload rejected", async () => {
  const res = await requestUpload(ownerCookie, {
    size: 999_999_999,
    contentType: "application/zip",
  });
  expect(res.status).toBe(422);
});

test("disallowed content type rejected", async () => {
  const res = await requestUpload(ownerCookie, { contentType: "application/octet-stream" });
  expect(res.status).toBe(422);
});

test("complete with missing object rejected", async () => {
  const create = await requestUpload(ownerCookie, { filename: "ghost.png" });
  const complete = await completeUpload(create.body.uploadId!);
  expect(complete.status).toBe(404);
});

test("complete happy path posts file message visible in history", async () => {
  const create = await requestUpload(ownerCookie);
  const uploadId = create.body.uploadId!;
  const key = `uploads/${uploadChannelId}/${uploadId}/pic.png`;
  const bytes = new Uint8Array(1024);
  bytes[0] = 0x89;
  bytes[1] = 0x50;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: "image/png" } });

  const complete = await completeUpload(uploadId);
  expect(complete.status).toBe(201);
  expect(complete.body.messageId).toBeTruthy();

  const stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(uploadChannelId)));
  const { messages } = await stub.history({ limit: 10 });
  const fileMsg = messages.find((m) => m.type === "file");
  expect(fileMsg).toBeTruthy();
  expect(fileMsg!.id).toBe(complete.body.messageId);
  expect(fileMsg!.content).toBe("");
  expect(fileMsg!.attachments).toEqual([
    { fileId: uploadId, key, name: "pic.png", size: 1024, mime: "image/png" },
  ]);
});

test("complete with size mismatch rejected", async () => {
  const create = await requestUpload(ownerCookie, {
    filename: "short.bin",
    size: 2048,
    contentType: "application/zip",
  });
  const uploadId = create.body.uploadId!;
  const key = `uploads/${uploadChannelId}/${uploadId}/short.bin`;
  await env.FILES.put(key, new TextEncoder().encode("tiny"), {
    httpMetadata: { contentType: "application/zip" },
  });
  const complete = await completeUpload(uploadId);
  expect(complete.status).toBe(422);
});

test("duplicate complete rejected", async () => {
  const create = await requestUpload(ownerCookie, { filename: "dup.png" });
  const uploadId = create.body.uploadId!;
  const key = `uploads/${uploadChannelId}/${uploadId}/dup.png`;
  await env.FILES.put(key, new Uint8Array(1024), { httpMetadata: { contentType: "image/png" } });
  const first = await completeUpload(uploadId);
  expect(first.status).toBe(201);
  const second = await completeUpload(uploadId);
  expect(second.status).toBe(409);
});
