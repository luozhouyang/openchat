import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { channelDoName, issueInternalToken, userDoName } from "protocol";

const channelId = "c-side";
const channel = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
const bob = env.USER_DO.get(env.USER_DO.idFromName(userDoName("bob")));

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(event as MessageEvent), { once: true });
  });
}

function collectUntil(ws: WebSocket, type: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 5000);
    const onMessage = (event: MessageEvent) => {
      const body = JSON.parse(String(event.data)) as { type: string };
      if (body.type === type) {
        clearTimeout(timer);
        ws.removeEventListener("message", onMessage);
        resolve(body);
      }
    };
    ws.addEventListener("message", onMessage);
  });
}

async function postMessage(userId: string, content: string, clientToken: string) {
  const res = await channel.postMessage(userId, { content, clientToken });
  expect(res).not.toHaveProperty("error");
  return res as { messageId: string; seq: number };
}

beforeAll(async () => {
  await channel.membersAdd({ userId: "alice", role: "member" });
  await channel.membersAdd({ userId: "bob", role: "member" });
});

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "sidebar-test-password", name: email.split("@")[0] }),
  });
  return res.headers.get("set-cookie") ?? "";
}

test("GET /users/me/sidebar requires session and returns channels", async () => {
  const noAuth = await exports.default.fetch("http://localhost/api/v1/users/me/sidebar");
  expect(noAuth.status).toBe(401);

  const cookie = await signup("sidebar-route@test.dev");
  const res = await exports.default.fetch("http://localhost/api/v1/users/me/sidebar", {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { channels: unknown[] };
  expect(Array.isArray(body.channels)).toBe(true);
});

test("sidebar aggregates unread across channels", async () => {
  await bob.channelsSubscribe([channelId]);
  await postMessage("alice", "sidebar test", "side-1");
  const body = await bob.sidebar();
  const entry = body.channels.find((c) => c.channelId === channelId)!;
  expect(entry.unread).toBe(1);
  expect(entry.preview).toBe("sidebar test");
  expect(entry.mentions).toBe(0);
});

test("mark_read frame syncs read state back to sidebar", async () => {
  const token = await issueInternalToken({ subject: "user:bob", secret: env.INTERNAL_TOKEN_KEY });
  const up = await bob.fetch(
    new Request(`http://user-do/ws?deviceId=d1&sub=bob`, {
      headers: { Upgrade: "websocket", "x-internal-token": token },
    }),
  );
  expect(up.status).toBe(101);
  const ws = up.webSocket!;
  ws.accept();
  const hello = await nextMessage(ws);
  expect(JSON.parse(String(hello.data))).toMatchObject({ type: "hello" });

  const sub = await channel.subscribe({ userId: "bob" });
  expect(sub.ok).toBe(true);

  const eventFrame = collectUntil(ws, "channel.event");
  const updateFrame = collectUntil(ws, "sidebar.update");
  await postMessage("alice", "ping @[bob]", "side-2");
  const event = (await eventFrame) as { event: { type: string; message: { seq: number } } };
  expect(event.event.type).toBe("message.new");
  const update = (await updateFrame) as {
    channelId: string;
    unread: number;
    mentions: number;
    lastMessage: { preview: string };
  };
  expect(update).toMatchObject({
    channelId,
    unread: 2,
    mentions: 1,
    lastMessage: { preview: "ping @[bob]" },
  });

  const readFrame = collectUntil(ws, "channel.read");
  ws.send(JSON.stringify({ type: "mark_read", channelId, seq: 2 }));
  const read = (await readFrame) as { channelId: string; lastReadSeq: number };
  expect(read).toEqual({ type: "channel.read", channelId, lastReadSeq: 2 });

  const body = await bob.sidebar();
  const entry = body.channels.find((c) => c.channelId === channelId)!;
  expect(entry.unread).toBe(0);
  expect(entry.mentions).toBe(0);
  expect(entry.lastReadSeq).toBe(2);
  ws.close(1000, "done");
});
