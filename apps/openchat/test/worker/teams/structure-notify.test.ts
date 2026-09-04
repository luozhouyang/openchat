import { expect, test } from "vite-plus/test";
import { exports } from "cloudflare:workers";

async function signup(email: string, username: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "structure-notify-password",
      name: username,
      username,
    }),
  });
  return res.headers.get("set-cookie") ?? "";
}

async function upgrade(cookie: string, deviceId: string): Promise<WebSocket> {
  const tokenRes = await exports.default.fetch("http://localhost/api/auth/token", {
    headers: { cookie },
  });
  const { token } = (await tokenRes.json()) as { token: string };
  const res = await exports.default.fetch(
    new Request(`http://localhost/ws?deviceId=${deviceId}`, {
      headers: { Upgrade: "websocket", authorization: `Bearer ${token}` },
    }),
  );
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  return ws;
}

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(event as MessageEvent), { once: true });
  });
}

function structureUpdatesWithin(ws: WebSocket, windowMs: number): Promise<number> {
  return new Promise((resolve) => {
    let count = 0;
    const onMsg = (event: MessageEvent) => {
      const body = JSON.parse(String(event.data)) as { type: string };
      if (body.type === "structure.update") count += 1;
    };
    ws.addEventListener("message", onMsg);
    setTimeout(() => {
      ws.removeEventListener("message", onMsg);
      resolve(count);
    }, windowMs);
  });
}

async function getWorkspaces(cookie: string): Promise<void> {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me/workspaces", {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
}

async function createTeamViaApi(cookie: string, name: string): Promise<void> {
  const res = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name, displayName: name, type: "open" }),
  });
  expect(res.status).toBe(201);
}

test("repeated workspaces reads do not re-broadcast structure.update", async () => {
  const cookie = await signup("loop-read@test.dev", "loopread");
  const ws = await upgrade(cookie, "loop-read-d1");
  const hello = await nextMessage(ws);
  expect(JSON.parse(String(hello.data))).toMatchObject({ type: "hello" });

  await getWorkspaces(cookie);
  expect(await structureUpdatesWithin(ws, 400)).toBe(0);

  // Regression: before the fix every read re-broadcast, echo-looping with the
  // client's structure-driven invalidation (~40 req/s of workspaces+sidebar).
  for (let i = 0; i < 5; i++) await getWorkspaces(cookie);
  expect(await structureUpdatesWithin(ws, 400)).toBe(0);
  ws.close(1000, "done");
});

test("team create broadcasts exactly once, later reads stay quiet", async () => {
  const cookie = await signup("loop-create@test.dev", "loopcreate");
  const ws = await upgrade(cookie, "loop-create-d1");
  const hello = await nextMessage(ws);
  expect(JSON.parse(String(hello.data))).toMatchObject({ type: "hello" });

  const counting = structureUpdatesWithin(ws, 1000);
  await createTeamViaApi(cookie, "loop-team");
  await getWorkspaces(cookie);
  await getWorkspaces(cookie);
  expect(await counting).toBe(1);
  ws.close(1000, "done");
});
