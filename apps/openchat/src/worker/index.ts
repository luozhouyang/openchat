import { createApp } from "@worker/app";
import { handleWsUpgrade } from "@worker/routes/ws";
import { ensureSeedRoles } from "@worker/auth/rbac";
import { getDb } from "@worker/db/client";
import { runMaintenance } from "@worker/maintenance";
import { reconcileBatch } from "@worker/services/reconcile.service";
import { UserDO } from "@worker/do/user";
import { ChannelDO } from "@worker/do/channel";

export { UserDO, ChannelDO };

const app = createApp();

let seeded = false;

async function ensureSeeded(env: Env) {
  if (seeded) {
    return;
  }
  seeded = true;
  try {
    await ensureSeedRoles(getDb(env.DB));
  } catch {
    // best-effort: a seed failure must not take down the worker
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    await ensureSeeded(env);
    const url = new URL(request.url);
    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      return handleWsUpgrade(request, env);
    }
    return app.fetch(request, env);
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      (async () => {
        await runMaintenance(env);
        await reconcileBatch(env, 5);
      })(),
    );
  },
};
