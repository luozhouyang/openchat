import { createApp } from "./app.ts";
import { issueInternalToken, userDoName } from "protocol";
import { UserDO } from "./do/user.ts";
import { ChannelDO } from "./do/channel.ts";

export { UserDO, ChannelDO };

const app = createApp();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      const token = await issueInternalToken({
        subject: "ws-upgrade",
        secret: env.INTERNAL_TOKEN_KEY,
      });
      const id = env.USER_DO.idFromName(userDoName("anonymous"));
      const stub = env.USER_DO.get(id);
      const upgraded = new Request(request);
      upgraded.headers.set("x-internal-token", token);
      return stub.fetch(upgraded);
    }
    return app.fetch(request, env);
  },
};
