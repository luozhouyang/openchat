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
      email: "internal@test.dev",
      password: "internal-test-password",
      name: "INT",
    }),
  });
  sessionCookie = signup.headers.get("set-cookie") ?? "";
});

function anyDoStub() {
  return env.USER_DO.get(env.USER_DO.idFromName(userDoName("any")));
}

function jwtSubject(token: string): string {
  const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
    sub: string;
  };
  return payload.sub;
}

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(event as MessageEvent), { once: true });
  });
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
  await stub.push({ channelId: "c1", event: { type: "message.new" } });
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
  await stub.push({ channelId: "c1", event: { type: "message.new" } });
  const event = await pushed;
  expect(JSON.parse(String(event.data))).toEqual({
    type: "channel.event",
    channelId: "c1",
    event: { type: "message.new" },
  });
});

test("forceDisconnect rejects subsequent upgrade with valid jwt", async () => {
  const tokenRes = await exports.default.fetch("http://localhost/api/auth/token", {
    headers: { cookie: sessionCookie },
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
