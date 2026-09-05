import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { makeAuth } from "@worker/auth";
import { verifyAuthJwt } from "@worker/jwks";
import { getDb } from "@worker/db/client";
import { users } from "@worker/db/schema-d1";
import { apiError } from "@worker/lib/errors";

export type SessionContext = {
  user: { id: string; email: string };
  session: { token: string; expiresAt: Date };
} | null;

export const requireSession = createMiddleware<{
  Bindings: Env;
  Variables: { session: SessionContext };
}>(async (c, next) => {
  const authHeader = c.req.header("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const auth = makeAuth(c.env);
  if (bearer) {
    const claims = await verifyAuthJwt(bearer, c.env);
    if (claims) {
      const db = getDb(c.env.DB);
      const rows = await db
        .select({ banned: users.banned })
        .from(users)
        .where(eq(users.id, claims.sub))
        .limit(1);
      const row = rows[0];
      if (row?.banned) {
        throw apiError("banned", "banned", 403);
      }
      c.set("session", {
        user: { id: claims.sub, email: claims.email ?? "" },
        session: {
          token: bearer,
          expiresAt: claims.exp !== undefined ? new Date(claims.exp * 1000) : new Date(),
        },
      });
      return next();
    }
    const full = await auth.api.getSession({ headers: c.req.raw.headers });
    if (full) {
      c.set("session", full);
      return next();
    }
    throw apiError("unauthorized", "unauthorized", 401);
  }
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    throw apiError("unauthorized", "unauthorized", 401);
  }
  c.set("session", session);
  return next();
});
