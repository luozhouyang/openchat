import { createApp } from "./app.ts";

const app = createApp();

export class UserDO {}
export class ChannelDO {}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      return new Response("not implemented", { status: 501 });
    }
    return app.fetch(request, env);
  },
};
