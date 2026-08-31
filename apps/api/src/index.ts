import { createApp } from "./app.ts";
import { handleWsUpgrade } from "./routes/ws.ts";
import { ensureSeedRoles } from "./auth/rbac.ts";
import { getDb } from "./db/client.ts";
import { UserDO } from "./do/user.ts";
import { ChannelDO } from "./do/channel.ts";

export { UserDO, ChannelDO };

const app = createApp();

let seeded = false;

async function ensureSeeded(env: Env) {
  if (seeded) return;
  seeded = true;
  try {
    await ensureSeedRoles(getDb(env.DB));
  } catch {
    // best-effort: a seed failure must not take down the worker
  }
}

const API_PREFIXES = [
  "/api/",
  "/me",
  "/teams",
  "/channels",
  "/admin",
  "/internal",
  "/uploads",
  "/files",
  "/ws",
  "/health",
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    await ensureSeeded(env);
    const url = new URL(request.url);
    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      return handleWsUpgrade(request, env);
    }
    const isApi = API_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(p));
    if (isApi) return app.fetch(request, env);
    return env.ASSETS.fetch(request);
  },
};
