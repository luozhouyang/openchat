import { Hono } from "hono";
import { UploadRequest, type CreateUploadOutput, type CompleteUploadOutput } from "protocol";
import { requireSession } from "../../auth/session.ts";
import { getDb } from "../../db/client.ts";
import { createUpload, completeUpload } from "../../services/upload.service.ts";
import { zodValidator } from "../../lib/validation.ts";

export const uploadsV1 = new Hono<{ Bindings: Env }>();

uploadsV1.post("/uploads", requireSession, zodValidator("json", UploadRequest), async (c) => {
  const body = c.req.valid("json");
  const { uploadId, putUrl } = await createUpload(getDb(c.env.DB), c.env, {
    channelId: body.channelId,
    userId: c.get("session")!.user.id,
    filename: body.filename,
    size: body.size,
    contentType: body.contentType,
  });
  const out: CreateUploadOutput = { uploadId, putUrl };
  return c.json(out, 201);
});
uploadsV1.post("/uploads/:uploadId/complete", requireSession, async (c) => {
  const { messageId } = await completeUpload(getDb(c.env.DB), c.env, {
    uploadId: c.req.param("uploadId"),
    userId: c.get("session")!.user.id,
  });
  const out: CompleteUploadOutput = { messageId };
  return c.json(out, 201);
});
