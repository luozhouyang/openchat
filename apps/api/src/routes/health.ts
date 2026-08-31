import { Hono } from "hono";

export const health = new Hono<{ Bindings: Env }>().get("/health", (c) =>
  c.json({ ok: true, ts: Date.now() }),
);
