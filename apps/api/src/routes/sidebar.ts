import { Hono } from "hono";
import { userDoName } from "protocol";
import { requireSession } from "../auth/session.ts";

export const sidebarRoutes = new Hono<{ Bindings: Env }>();

sidebarRoutes.get("/me/sidebar", requireSession, async (c) => {
  const userId = c.get("session")!.user.id;
  const id = c.env.USER_DO.idFromName(userDoName(userId));
  const result = await c.env.USER_DO.get(id).sidebar();
  return c.json(result);
});
