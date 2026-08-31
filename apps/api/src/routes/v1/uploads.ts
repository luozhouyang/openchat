import { Hono } from "hono";
import { z } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { requireSession } from "../../auth/session.ts";
import { getDb } from "../../db/client.ts";
import { createUpload, completeUpload } from "../../services/upload.service.ts";
import { HttpError } from "../../lib/errors.ts";

const UploadRequest = z.object({
  channelId: z.string().min(1),
  filename: z.string().min(1).max(512),
  size: z.number().int().positive(),
  contentType: z.string().min(1),
});

export const uploadsV1 = new Hono<{ Bindings: Env }>();

uploadsV1.post("/uploads", requireSession, async (c) => {
  const body = UploadRequest.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 422);
  try {
    const { uploadId, putUrl } = await createUpload(getDb(c.env.DB), c.env, {
      channelId: body.data.channelId,
      userId: c.get("session")!.user.id,
      filename: body.data.filename,
      size: body.data.size,
      contentType: body.data.contentType,
    });
    return c.json({ uploadId, putUrl }, 201);
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
});

uploadsV1.post("/uploads/:uploadId/complete", requireSession, async (c) => {
  try {
    const { messageId } = await completeUpload(getDb(c.env.DB), c.env, {
      uploadId: c.req.param("uploadId"),
      userId: c.get("session")!.user.id,
    });
    return c.json({ messageId }, 201);
  } catch (err) {
    if (err instanceof HttpError)
      return c.json({ error: err.code }, err.status as ContentfulStatusCode);
    throw err;
  }
});
