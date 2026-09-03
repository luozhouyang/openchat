import { expect, test } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { channelDoName } from "protocol";
import { getDb } from "../../src/worker/db/client.ts";
import { uploadsessions } from "../../src/worker/db/schema-d1.ts";

function channelStub(channelId: string) {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
}

async function postFileMessage(
  stub: ReturnType<typeof channelStub>,
  fileId: string,
  clientToken: string,
) {
  const res = await stub.postMessage("alice", {
    content: "",
    type: "file",
    clientToken,
    attachments: [
      { fileId, key: `uploads/c-file/${fileId}/a.png`, name: "a.png", size: 10, mime: "image/png" },
    ],
  });
  if ("error" in res) throw new Error(`post file message failed: ${res.status}`);
  return res.messageId;
}

test("updateThumbByUpload writes thumbUrl back into matching attachment", async () => {
  const stub = channelStub("c-file");
  await stub.membersAdd({ userId: "alice", role: "member" });
  await postFileMessage(stub, "up1", "file-att-1");

  const res = await stub.updateThumbByUpload({
    uploadId: "up1",
    thumbUrl: "/files/c-file/up1?thumb=1",
    thumbKey: "thumbnails/uploads/c-file/up1/a.png",
  });
  expect(res).toEqual({ ok: true });

  const { messages } = await stub.history({ limit: 5 });
  expect(messages[0].type).toBe("file");
  expect(messages[0].attachments?.[0]).toMatchObject({
    fileId: "up1",
    thumbUrl: "/files/c-file/up1?thumb=1",
  });
});

test("updateThumbByUpload ignores messages without matching fileId", async () => {
  const stub = channelStub("c-file");
  await postFileMessage(stub, "up-other", "file-att-2");

  await stub.updateThumbByUpload({
    uploadId: "missing",
    thumbUrl: "/files/c-file/missing?thumb=1",
    thumbKey: "thumbnails/uploads/c-file/missing/a.png",
  });

  const { messages } = await stub.history({ limit: 5 });
  expect(messages[0].attachments?.[0].thumbUrl).toBeUndefined();
});

test("updateAttachments returns 404 for missing message", async () => {
  const stub = channelStub("c-file");
  const res = await stub.updateAttachments({
    messageId: "does-not-exist",
    attachments: [{ fileId: "up1", thumbUrl: "/files/c-file/up1?thumb=1" }],
  });
  expect(res).toEqual({ error: "not found", status: 404 });
});

test("updateAttachments replaces attachments and broadcasts edit payload", async () => {
  const stub = channelStub("c-file");
  const messageId = await postFileMessage(stub, "up-update", "file-att-3");

  const res = await stub.updateAttachments({
    messageId,
    attachments: [
      {
        fileId: "up-update",
        name: "a.png",
        size: 10,
        mime: "image/png",
        thumbUrl: "/files/c-file/up-update?thumb=1",
      },
    ],
  });
  expect(res).toBeUndefined();

  const { messages } = await stub.history({ limit: 5 });
  expect(messages[0].attachments?.[0].thumbUrl).toBe("/files/c-file/up-update?thumb=1");
});

test("internal thumbnail endpoint rejects missing token", async () => {
  const res = await exports.default.fetch("http://localhost/internal/thumbnail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channelId: "c-file", uploadId: "up1", thumbKey: "thumbnails/up1" }),
  });
  expect(res.status).toBe(403);
});

test("internal thumbnail endpoint rejects upload not complete", async () => {
  const res = await exports.default.fetch("http://localhost/internal/thumbnail", {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-token": env.INTERNAL_TOKEN_KEY },
    body: JSON.stringify({
      channelId: "c-file",
      uploadId: "ghost-upload",
      thumbKey: "thumbnails/ghost",
    }),
  });
  expect(res.status).toBe(404);
});

test("internal thumbnail endpoint writes thumbUrl for complete upload", async () => {
  const stub = channelStub("c-file");
  const uploadId = "up-complete";
  await postFileMessage(stub, uploadId, "file-att-4");
  await getDb(env.DB)
    .insert(uploadsessions)
    .values({
      id: uploadId,
      type: "image/png",
      createdAt: Date.now(),
      userId: "alice",
      channelId: "c-file",
      filename: "a.png",
      path: `uploads/c-file/${uploadId}/a.png`,
      fileSize: 10,
      fileOffset: 10,
    });

  const res = await exports.default.fetch("http://localhost/internal/thumbnail", {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-token": env.INTERNAL_TOKEN_KEY },
    body: JSON.stringify({
      channelId: "c-file",
      uploadId,
      thumbKey: `thumbnails/uploads/c-file/${uploadId}/a.png`,
    }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const { messages } = await stub.history({ limit: 5 });
  expect(messages[0].attachments?.[0].thumbUrl).toBe(`/files/c-file/${uploadId}?thumb=1`);
});
