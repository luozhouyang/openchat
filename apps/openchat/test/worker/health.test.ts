import { env, exports } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";
import { sql } from "drizzle-orm";
import { getDb } from "@worker/db/client";

test("GET /health returns ok", async () => {
  const res = await exports.default.fetch("http://localhost/health");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(true);
});

test("/ws upgrade without token returns 401", async () => {
  const req = new Request("http://localhost/ws", {
    headers: { Upgrade: "websocket" },
  });
  const res = await exports.default.fetch(req);
  expect(res.status).toBe(401);
});

test("d1 migrations applied: teams table exists", async () => {
  const db = getDb(env.DB);
  const rows = await db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type='table' AND name='teams'`,
  );
  expect(rows).toHaveLength(1);
});
