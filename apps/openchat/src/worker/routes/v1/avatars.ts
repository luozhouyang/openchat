import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { requireSession } from "@worker/auth/session";
import { getDb } from "@worker/db/client";
import { users } from "@worker/db/schema-d1";
import { apiError } from "@worker/lib/errors";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export const avatarsV1 = new Hono<{ Bindings: Env }>();

avatarsV1.post("/users/me/avatar", requireSession, async (c) => {
  const userId = c.get("session")!.user.id;
  const contentType = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!ALLOWED_TYPES.has(contentType)) {
    throw apiError("invalid_avatar_type", "invalid avatar type", 415);
  }
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw apiError("invalid_avatar", "empty avatar", 422);
  }
  if (bytes.byteLength > MAX_AVATAR_BYTES) {
    throw apiError("avatar_too_large", "avatar too large", 413);
  }
  const key = `avatars/${userId}`;
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType } });
  // The query string busts cached images after a re-upload.
  const avatarUrl = `/api/v1/users/${userId}/avatar?v=${Date.now()}`;
  const db = getDb(c.env.DB);
  await db.update(users).set({ image: avatarUrl, avatarUrl }).where(eq(users.id, userId));
  return c.json({ avatarUrl });
});

// Avatars are non-sensitive and referenced from `<img>` tags, which cannot
// carry bearer tokens; keep the read public and cacheable.
avatarsV1.get("/users/:userId/avatar", async (c) => {
  const target = c.req.param("userId");
  const object = await c.env.FILES.get(`avatars/${target}`);
  if (!object) {
    throw apiError("avatar_not_found", "avatar not found", 404);
  }
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=300",
    },
  });
});
