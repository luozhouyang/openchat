import { Hono } from "hono";
import { requireAdmin } from "../auth/admin-gate.ts";

export const adminRoutes = new Hono<{ Bindings: Env }>();
adminRoutes.use("*", requireAdmin);

adminRoutes.get("/settings", (c) => c.json({ registrationMode: "open" }));
