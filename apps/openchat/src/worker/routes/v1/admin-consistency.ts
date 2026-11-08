import { Hono } from "hono";
import { requireAdmin } from "@worker/auth/admin-gate";
import type { SessionContext } from "@worker/auth/session";
import { reconcileChannel } from "@worker/services/reconcile.service";

export const adminConsistencyV1 = new Hono<{
  Bindings: Env;
  Variables: { session: SessionContext; adminUserId: string };
}>();

adminConsistencyV1.use("*", requireAdmin);

adminConsistencyV1.post("/channels/:channelId/reconcile", async (c) => {
  const result = await reconcileChannel(c.env, c.req.param("channelId"));
  return c.json(result);
});
