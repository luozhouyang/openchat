import { Hono } from "hono";
import { health } from "./routes/health.ts";
import { internalRoutes } from "./routes/internal.ts";
import { v1Router } from "./routes/v1/index.ts";
import { makeAuth } from "./auth.ts";

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", health);
  app.route("/api/v1", v1Router);
  app.route("/", internalRoutes);
  app.all("/api/auth/*", async (c) => {
    const auth = makeAuth(c.env);
    return auth.handler(c.req.raw);
  });
  return app;
}
