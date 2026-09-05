import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { getDb } from "@worker/db/client";
import { users } from "@worker/db/schema-d1";
import { requireSession, type SessionContext } from "@worker/auth/session";
import { apiError } from "@worker/lib/errors";

export const requireAdmin = createMiddleware<{
  Bindings: Env;
  Variables: { session: SessionContext; adminUserId: string };
}>(async (c, next) => {
  await requireSession(c as unknown as Parameters<typeof requireSession>[0], async () => {});
  const session = c.get("session");
  if (!session) {
    throw apiError("unauthorized", "unauthorized", 401);
  }
  const db = getDb(c.env.DB);
  const rows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  const row = rows[0];
  if (row?.role !== "admin") {
    throw apiError("forbidden", "forbidden", 403);
  }
  c.set("adminUserId", session.user.id);
  return next();
});
