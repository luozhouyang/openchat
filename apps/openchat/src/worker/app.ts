import { Hono } from "hono";
import { health } from "./routes/health.ts";
import { internalRoutes } from "./routes/internal.ts";
import { v1Router } from "./routes/v1/index.ts";
import { makeAuth } from "./auth.ts";
import { isHttpError, toErrorBody } from "./lib/errors.ts";

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", health);
  app.route("/api/v1", v1Router);
  app.route("/", internalRoutes);
  app.all("/api/auth/*", async (c) => {
    const auth = makeAuth(c.env);
    return auth.handler(c.req.raw);
  });
  app.onError((err, c) => {
    if (isHttpError(err))
      return c.json(toErrorBody(err), err.status as 400 | 403 | 404 | 409 | 422 | 429 | 500);
    console.error(`[${c.req.method}] ${c.req.path}:`, err);
    return c.json({ error: "internal server error", code: "internal" }, 500);
  });
  return app;
}
