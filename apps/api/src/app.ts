import { Hono } from "hono";
import { health } from "./routes/health.ts";
import { makeAuth } from "./auth.ts";

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", health);
  app.all("/api/auth/*", async (c) => {
    const auth = makeAuth(c.env);
    return auth.handler(c.req.raw);
  });
  return app;
}
