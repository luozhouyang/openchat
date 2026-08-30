import { expect, test, beforeAll, afterAll } from "vite-plus/test";
import { unstable_dev, type Unstable_DevWorker } from "wrangler";
import workerHandler from "../src/index.ts";

let worker: Unstable_DevWorker;

beforeAll(async () => {
  worker = await unstable_dev("src/index.ts", {
    config: "wrangler.jsonc",
    experimental: { disableExperimentalWarning: true },
  });
});

afterAll(async () => {
  await worker.stop();
});

test("GET /health returns ok", async () => {
  const res = await worker.fetch("/health");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(true);
});

test("/ws upgrade without implementation returns 501", async () => {
  const req = new Request("http://localhost/ws", {
    headers: { Upgrade: "websocket" },
  });
  const res = await workerHandler.fetch(req, {} as Env);
  expect(res.status).toBe(501);
});
