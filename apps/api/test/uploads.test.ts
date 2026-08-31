import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { channelDoName } from "protocol";

let ownerCookie = "";
let outsiderCookie = "";
let channelId = "";

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "upload-test-password", name: email.split("@")[0] }),
  });
  return res.headers.get("set-cookie") ?? "";
}

async function requestUpload(cookie: string, overrides: Record<string, unknown> = {}) {
  const res = await exports.default.fetch("http://localhost/api/v1/uploads", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      channelId,
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
  ownerCookie = await signup("upload-owner@test.dev");
  outsiderCookie = await signup("upload-outsider@test.dev");
  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "upteam", display_name: "Up Team", type: "open" }),
  });
  const teamId = ((await team.json()) as { id: string }).id;
  const ch = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ team_id: teamId, name: "files", display_name: "Files", type: "public" }),
  });
  channelId = ((await ch.json()) as { id: string }).id;
});

test("upload request returns presigned url for member", async () => {
  const res = await requestUpload(ownerCookie);
  expect(res.status).toBe(201);
  expect(res.body.putUrl).toContain("X-Amz-Signature");
});

test("non-member upload request rejected", async () => {
  const res = await requestUpload(outsiderCookie);
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
  const key = `uploads/${channelId}/${uploadId}/pic.png`;
  const bytes = new Uint8Array(1024);
  bytes[0] = 0x89;
  bytes[1] = 0x50;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: "image/png" } });

  const complete = await completeUpload(uploadId);
  expect(complete.status).toBe(201);
  expect(complete.body.messageId).toBeTruthy();

  const stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
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
  const key = `uploads/${channelId}/${uploadId}/short.bin`;
  await env.FILES.put(key, new TextEncoder().encode("tiny"), {
    httpMetadata: { contentType: "application/zip" },
  });
  const complete = await completeUpload(uploadId);
  expect(complete.status).toBe(422);
});

test("duplicate complete rejected", async () => {
  const create = await requestUpload(ownerCookie, { filename: "dup.png" });
  const uploadId = create.body.uploadId!;
  const key = `uploads/${channelId}/${uploadId}/dup.png`;
  await env.FILES.put(key, new Uint8Array(1024), { httpMetadata: { contentType: "image/png" } });
  const first = await completeUpload(uploadId);
  expect(first.status).toBe(201);
  const second = await completeUpload(uploadId);
  expect(second.status).toBe(409);
});
