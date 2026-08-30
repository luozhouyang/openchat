import { createApp } from "./app.ts";
import { handleWsUpgrade } from "./routes/ws.ts";
import { UserDO } from "./do/user.ts";
import { ChannelDO } from "./do/channel.ts";

export { UserDO, ChannelDO };

const app = createApp();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      return handleWsUpgrade(request, env);
    }
    return app.fetch(request, env);
  },
};
