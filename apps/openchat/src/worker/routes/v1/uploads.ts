import { Hono } from "hono";
import {
  UploadRequest,
  type AttachUploadOutput,
  type CreateUploadOutput,
  type CompleteUploadOutput,
} from "protocol";
import { requireSession } from "@worker/auth/session";
import { getDb } from "@worker/db/client";
import { attachUpload, completeUpload, createUpload } from "@worker/services/upload.service";
import { zodValidator } from "@worker/lib/validation";

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
uploadsV1.post("/uploads/:uploadId/attach", requireSession, async (c) => {
  const { attachment } = await attachUpload(getDb(c.env.DB), {
    uploadId: c.req.param("uploadId"),
    userId: c.get("session")!.user.id,
  });
  const out: AttachUploadOutput = { attachment };
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
