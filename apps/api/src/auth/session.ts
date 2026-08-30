import { createMiddleware } from "hono/factory";
import { makeAuth } from "../auth.ts";
import { verifyAuthJwt } from "../jwks.ts";

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
      c.set("session", {
        user: { id: claims.sub, email: claims.email ?? "" },
        session: { token: bearer, expiresAt: new Date() },
      });
      return next();
    }
    const full = await auth.api.getSession({ headers: c.req.raw.headers });
    if (full) {
      c.set("session", full);
      return next();
    }
    return c.json({ error: "unauthorized" }, 401);
  }
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("session", session);
  return next();
});
