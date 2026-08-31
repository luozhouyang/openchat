import { createApp } from "./app.ts";
import { handleWsUpgrade } from "./routes/ws.ts";
import { UserDO } from "./do/user.ts";
import { ChannelDO } from "./do/channel.ts";

export { UserDO, ChannelDO };

const app = createApp();

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
    const url = new URL(request.url);
    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      return handleWsUpgrade(request, env);
    }
    const isApi = API_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(p));
    if (isApi) return app.fetch(request, env);
    return env.ASSETS.fetch(request);
  },
};
