import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { users } from "../db/schema-d1.ts";
import { requireSession, type SessionContext } from "./session.ts";

export const requireAdmin = createMiddleware<{
  Bindings: Env;
  Variables: { session: SessionContext; adminUserId: string };
}>(async (c, next) => {
  await requireSession(c as unknown as Parameters<typeof requireSession>[0], async () => {});
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const db = getDb(c.env.DB);
  const rows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (rows[0]?.role !== "admin") return c.json({ error: "forbidden" }, 403);
  c.set("adminUserId", session.user.id);
  return next();
});
