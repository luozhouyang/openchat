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

interface TestSocket {
  ws: WebSocket;
  read(): Promise<MessageEvent>;
}

async function upgrade(cookie: string, deviceId: string): Promise<TestSocket> {
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
  const queue: MessageEvent[] = [];
  let waiter: ((event: MessageEvent) => void) | null = null;
  ws.addEventListener("message", (event) => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(event as MessageEvent);
    } else {
      queue.push(event as MessageEvent);
    }
  });
  return {
    ws,
    read: () =>
      new Promise<MessageEvent>((resolve) => {
        const buffered = queue.shift();
        if (buffered) resolve(buffered);
        else waiter = resolve;
      }),
  };
}

function nextMessage(sock: TestSocket): Promise<MessageEvent> {
  return sock.read();
}

function collectEventsWithin(sock: TestSocket, windowMs: number): Promise<{ type: string }[]> {
  return new Promise((resolve) => {
    const frames: { type: string }[] = [];
    let done = false;
    const drain = () => {
      sock.read().then((event) => {
        if (done) return;
        frames.push(JSON.parse(String(event.data)) as { type: string });
        drain();
      });
    };
    drain();
    setTimeout(() => {
      done = true;
      resolve(frames);
    }, windowMs);
  });
}

function structureUpdateCount(frames: { type: string }[]): number {
  return frames.filter((f) => f.type === "structure.update").length;
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
  expect(structureUpdateCount(await collectEventsWithin(ws, 400))).toBe(0);

  // Regression: before the fix every read re-broadcast, echo-looping with the
  // client's structure-driven invalidation (~40 req/s of workspaces+sidebar).
  for (let i = 0; i < 5; i++) await getWorkspaces(cookie);
  expect(structureUpdateCount(await collectEventsWithin(ws, 400))).toBe(0);
  ws.ws.close(1000, "done");
});

test("team create emits team.member_added exactly once, later reads stay quiet", async () => {
  const cookie = await signup("loop-create@test.dev", "loopcreate");
  const ws = await upgrade(cookie, "loop-create-d1");
  const hello = await nextMessage(ws);
  expect(JSON.parse(String(hello.data))).toMatchObject({ type: "hello" });

  const counting = collectEventsWithin(ws, 1000);
  await createTeamViaApi(cookie, "loop-team");
  await getWorkspaces(cookie);
  await getWorkspaces(cookie);
  const frames = await counting;
  expect(frames.filter((f) => f.type === "team.member_added")).toHaveLength(1);
  expect(frames.filter((f) => f.type === "structure.update")).toHaveLength(0);
  ws.ws.close(1000, "done");
});
