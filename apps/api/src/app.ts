import { Hono } from "hono";
import { health } from "./routes/health.ts";

export function createApp() {
  const app = new Hono();
  app.route("/", health);
  return app;
}
