import { expect, test } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";

test("GET /health returns ok", async () => {
  const res = await exports.default.fetch("http://localhost/health");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(true);
});

test("/ws upgrade reaches UserDO", async () => {
  const req = new Request("http://localhost/ws", {
    headers: { Upgrade: "websocket" },
  });
  const res = await exports.default.fetch(req);
  expect(res.status).toBe(101);
});

test("d1 migrations applied: teams table exists", async () => {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='teams'",
  ).all();
  expect(results).toHaveLength(1);
});
