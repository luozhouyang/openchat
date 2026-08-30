import { Hono } from "hono";
import { health } from "./routes/health.ts";
import { teamsRoutes } from "./routes/teams.ts";
import { channelsRoutes } from "./routes/channels.ts";
import { workspacesRoutes } from "./routes/workspaces.ts";
import { sidebarRoutes } from "./routes/sidebar.ts";
import { makeAuth } from "./auth.ts";
import { requireSession } from "./auth/session.ts";

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", health);
  app.route("/", teamsRoutes);
  app.route("/", channelsRoutes);
  app.route("/", workspacesRoutes);
  app.route("/", sidebarRoutes);
  app.get("/me", requireSession, (c) => {
    const session = c.get("session");
    return c.json({ user: session?.user });
  });
  app.all("/api/auth/*", async (c) => {
    const auth = makeAuth(c.env);
    return auth.handler(c.req.raw);
  });
  return app;
}
