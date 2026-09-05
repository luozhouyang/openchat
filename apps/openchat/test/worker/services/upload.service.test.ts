import { env } from "cloudflare:workers";
import { expect, test, beforeAll } from "vite-plus/test";
import { channelDoName } from "protocol";
import { getDb } from "@worker/db/client";
import { createChannel } from "@worker/db/repos/channels";
import { createTeam } from "@worker/db/repos/teams";
import { createUpload, completeUpload } from "@worker/services/upload.service";

const OWNER = "upl-svc-alice";
const TEAM = "upl-svc-team";
const CHANNEL = "upl-svc-channel";

function channelStub() {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(CHANNEL)));
}

beforeAll(async () => {
  const db = getDb(env.DB);
  await createTeam(db, {
    id: TEAM,
    name: TEAM,
    displayName: "UplCo",
    type: "open",
    inviteCode: null,
    creatorId: OWNER,
  });
  await createChannel(db, {
    id: CHANNEL,
    teamId: TEAM,
    name: "files",
    displayName: "Files",
    type: "public",
    dedupKey: null,
    creatorId: OWNER,
  });
  await channelStub().membersAdd({ userId: OWNER, role: "admin" });
});

test("createUpload rejects disallowed content type with 422", async () => {
  const db = getDb(env.DB);
  await expect(
    createUpload(db, env, {
      channelId: CHANNEL,
      userId: OWNER,
      filename: "blob.bin",
      size: 1024,
      contentType: "application/octet-stream",
    }),
  ).rejects.toMatchObject({ status: 422, code: "type not allowed" });
});

test("createUpload rejects oversized upload with 422", async () => {
  const db = getDb(env.DB);
  await expect(
    createUpload(db, env, {
      channelId: CHANNEL,
      userId: OWNER,
      filename: "big.zip",
      size: 999_999_999,
      contentType: "application/zip",
    }),
  ).rejects.toMatchObject({ status: 422, code: "too large" });
});

test("createUpload happy path returns uploadId and presigned putUrl", async () => {
  const db = getDb(env.DB);
  const res = await createUpload(db, env, {
    channelId: CHANNEL,
    userId: OWNER,
    filename: "pic.png",
    size: 1024,
    contentType: "image/png",
  });
  expect(res.uploadId).toBeTruthy();
  expect(res.putUrl).toContain("X-Amz-Signature");
});

test("completeUpload happy path posts file message", async () => {
  const db = getDb(env.DB);
  const { uploadId } = await createUpload(db, env, {
    channelId: CHANNEL,
    userId: OWNER,
    filename: "pic.png",
    size: 1024,
    contentType: "image/png",
  });
  const key = `uploads/${CHANNEL}/${uploadId}/pic.png`;
  const bytes = new Uint8Array(1024);
  bytes[0] = 0x89;
  bytes[1] = 0x50;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: "image/png" } });

  const { messageId } = await completeUpload(db, env, { uploadId, userId: OWNER });
  expect(messageId).toBeTruthy();

  const { messages } = await channelStub().history({ limit: 10 });
  const fileMsg = messages.find((m) => m.type === "file");
  expect(fileMsg).toBeTruthy();
  expect(fileMsg!.id).toBe(messageId);
  expect(fileMsg!.attachments).toEqual([
    { fileId: uploadId, key, name: "pic.png", size: 1024, mime: "image/png" },
  ]);
});
