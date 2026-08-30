import { expect, test } from "vite-plus/test";
import { env, runInDurableObject } from "cloudflare:test";
import { exports } from "cloudflare:workers";

async function upgrade(deviceId: string): Promise<WebSocket> {
  const req = new Request(`http://localhost/ws?deviceId=${deviceId}`, {
    headers: { Upgrade: "websocket" },
  });
  const res = await exports.default.fetch(req);
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  expect(ws).toBeDefined();
  ws!.accept();
  return ws!;
}

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(event as MessageEvent), { once: true });
  });
}

test("upgrade twice with same deviceId closes the old connection", async () => {
  const first = await upgrade("d1");
  const closed = new Promise<CloseEvent>((resolve) =>
    first.addEventListener("close", resolve, { once: true }),
  );
  await upgrade("d1");
  const ev = await closed;
  expect(ev.code).toBe(4000);
});

test("upgrades with different deviceIds keep both connections", async () => {
  const first = await upgrade("d1");
  let closed = false;
  first.addEventListener(
    "close",
    () => {
      closed = true;
    },
    { once: true },
  );
  await upgrade("d2");
  await new Promise((r) => setTimeout(r, 50));
  expect(closed).toBe(false);
});

test("hello event sent on upgrade", async () => {
  const ws = await upgrade("d1");
  const event = await nextMessage(ws);
  const body = JSON.parse(String(event.data)) as { type: string; userId: string };
  expect(body.type).toBe("hello");
  expect(body.userId.length).toBeGreaterThan(0);
});

test("echo frame is parsed and echoed", async () => {
  const ws = await upgrade("d1");
  const hello = await nextMessage(ws);
  expect(JSON.parse(String(hello.data))).toMatchObject({ type: "hello" });
  ws.send(JSON.stringify({ type: "echo", data: "hi" }));
  const event = await nextMessage(ws);
  const body = JSON.parse(String(event.data)) as { type: string; data: string };
  expect(body).toEqual({ type: "echo", data: "hi" });
});

test("health reports devices and channels", async () => {
  const id = env.USER_DO.idFromName("user:anonymous");
  const stub = env.USER_DO.get(id);
  const res = await runInDurableObject(stub, (instance) =>
    instance.fetch(new Request("http://localhost/health")),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; devices: number; channels: number };
  expect(body.ok).toBe(true);
  expect(body.devices).toBeGreaterThanOrEqual(0);
  expect(body.channels).toBe(0);
});
