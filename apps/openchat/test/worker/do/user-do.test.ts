import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { issueInternalToken, userDoName } from "protocol";

let sessionCookie = "";

beforeAll(async () => {
  const signup = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "devices@test.dev",
      password: "devices-test-password",
      name: "Devices",
    }),
  });
  sessionCookie = signup.headers.get("set-cookie") ?? "";
});

async function upgrade(deviceId: string): Promise<WebSocket> {
  const tokenRes = await exports.default.fetch("http://localhost/api/auth/token", {
    headers: { cookie: sessionCookie },
  });
  const { token } = (await tokenRes.json()) as { token: string };
  const req = new Request(`http://localhost/ws?deviceId=${deviceId}`, {
    headers: { Upgrade: "websocket", authorization: `Bearer ${token}` },
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

function jwtSubject(token: string): string {
  const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
    sub: string;
  };
  return payload.sub;
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
  const body = await stub.health();
  expect(body.ok).toBe(true);
  expect(body.devices).toBeGreaterThanOrEqual(0);
  expect(body.channels).toBe(0);
});

let internalSessionCookie = "";

beforeAll(async () => {
  const signup = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "internal@test.dev",
      password: "internal-test-password",
      name: "INT",
    }),
  });
  internalSessionCookie = signup.headers.get("set-cookie") ?? "";
});

function anyDoStub() {
  return env.USER_DO.get(env.USER_DO.idFromName(userDoName("any")));
}

test("channelsSubscribe then health reflects channel count", async () => {
  const stub = anyDoStub();
  await stub.channelsSubscribe(["c1", "c2"]);
  const health = await stub.health();
  expect(health.ok).toBe(true);
  expect(health.channels).toBe(2);
});

test("push with no device connected leaves health unchanged", async () => {
  const stub = anyDoStub();
  const before = await stub.health();
  await stub.push({ channelId: "c1", events: [{ type: "message.new" }] });
  const after = await stub.health();
  expect(after).toEqual(before);
});

test("push forwards channel event to connected device", async () => {
  const stub = anyDoStub();
  const token = await issueInternalToken({ subject: "user:any", secret: env.INTERNAL_TOKEN_KEY });
  const up = await stub.fetch(
    new Request("http://user-do/ws?deviceId=d1", {
      headers: { Upgrade: "websocket", "x-internal-token": token },
    }),
  );
  expect(up.status).toBe(101);
  const ws = up.webSocket;
  expect(ws).toBeDefined();
  ws!.accept();
  const hello = await nextMessage(ws!);
  expect(JSON.parse(String(hello.data))).toMatchObject({ type: "hello" });

  const pushed = nextMessage(ws!);
  await stub.push({ channelId: "c1", events: [{ type: "message.new" }] });
  const event = await pushed;
  expect(JSON.parse(String(event.data))).toEqual({
    type: "channel.event",
    channelId: "c1",
    event: { type: "message.new" },
  });
});

test("forceDisconnect rejects subsequent upgrade with valid jwt", async () => {
  const tokenRes = await exports.default.fetch("http://localhost/api/auth/token", {
    headers: { cookie: internalSessionCookie },
  });
  const { token } = (await tokenRes.json()) as { token: string };
  const userId = jwtSubject(token);
  const stub = env.USER_DO.get(env.USER_DO.idFromName(userDoName(userId)));

  const first = await exports.default.fetch(
    new Request("http://localhost/ws?deviceId=d1", {
      headers: { Upgrade: "websocket", authorization: `Bearer ${token}` },
    }),
  );
  expect(first.status).toBe(101);

  await stub.forceDisconnect();

  const banned = await exports.default.fetch(
    new Request("http://localhost/ws?deviceId=d1", {
      headers: { Upgrade: "websocket", authorization: `Bearer ${token}` },
    }),
  );
  expect(banned.status).toBe(403);
});
