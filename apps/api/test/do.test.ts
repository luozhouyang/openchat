import { expect, test } from "vite-plus/test";
import { env, runInDurableObject } from "cloudflare:test";

test("UserDO health reports devices and channels", async () => {
  const id = env.USER_DO.idFromName("user:anonymous");
  const stub = env.USER_DO.get(id);
  const body = await stub.health();
  expect(body.ok).toBe(true);
  expect(body.devices).toBeGreaterThanOrEqual(0);
  expect(body.channels).toBe(0);
});

test("ChannelDO health reports migrated schema", async () => {
  const id = env.CHANNEL_DO.idFromName("channel:anonymous");
  const stub = env.CHANNEL_DO.get(id);
  const res = await runInDurableObject(stub, (instance) =>
    instance.fetch(new Request("http://localhost/health")),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; migrated: boolean };
  expect(body.ok).toBe(true);
  expect(body.migrated).toBe(true);
});

test("UserDO rejects upgrade without valid internal token", async () => {
  const id = env.USER_DO.idFromName("user:anonymous");
  const stub = env.USER_DO.get(id);
  const req = new Request("http://localhost/ws", {
    headers: {
      Upgrade: "websocket",
      "x-internal-token": "bogus-token",
    },
  });
  const res = await stub.fetch(req);
  expect(res.status).toBe(403);
});
