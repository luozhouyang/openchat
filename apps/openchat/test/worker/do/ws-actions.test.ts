import { expect, test, beforeAll } from "vite-plus/test";
import { env, runInDurableObject } from "cloudflare:test";
import { channelDoName, issueInternalToken, userDoName } from "protocol";
import * as schema from "../../../src/worker/db/schema-channel-do.ts";

const channelId = "c-ws-actions";
const channel = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));

let rootId = "";
let msgSeq = 0;

beforeAll(async () => {
  await channel.membersAdd({ userId: "alice", role: "member" });
  await channel.membersAdd({ userId: "bob", role: "member" });
  const post = await channel.postMessage("alice", {
    content: "root",
    clientToken: "ws-actions-root",
  });
  if ("error" in post) throw new Error(post.error);
  rootId = post.messageId;
  msgSeq = post.seq;
});

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(event as MessageEvent), { once: true });
  });
}

async function openWs(userId: string, deviceId: string): Promise<WebSocket> {
  const userDo = env.USER_DO.get(env.USER_DO.idFromName(userDoName(userId)));
  const token = await issueInternalToken({
    subject: `user:${userId}`,
    secret: env.INTERNAL_TOKEN_KEY,
  });
  const up = await userDo.fetch(
    new Request(`http://user-do/ws?deviceId=${deviceId}&sub=${userId}`, {
      headers: { Upgrade: "websocket", "x-internal-token": token },
    }),
  );
  expect(up.status).toBe(101);
  const ws = up.webSocket!;
  ws.accept();
  const hello = await nextMessage(ws);
  expect(JSON.parse(String(hello.data))).toMatchObject({ type: "hello" });
  return ws;
}

async function collect(ws: WebSocket, n: number): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let i = 0; i < n; i++) {
    out.push(JSON.parse(String((await nextMessage(ws)).data)));
  }
  return out;
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

async function threadSubscribed(userId: string): Promise<boolean> {
  const rows = await runInDurableObject(channel, (instance) =>
    instance.db.select().from(schema.threadSubscriptions).all(),
  );
  return rows.some((r) => r.parentId === rootId && r.userId === userId);
}

test("react frame toggles reaction in channel", async () => {
  const aliceWs = await openWs("alice", "d-react");
  aliceWs.send(JSON.stringify({ type: "react", channelId, messageSeq: msgSeq, emoji: "👍" }));
  expect(
    await waitFor(async () => (await channel.reactionSnapshot(msgSeq))["👍"]?.includes("alice")),
  ).toBe(true);
  aliceWs.send(JSON.stringify({ type: "react", channelId, messageSeq: msgSeq, emoji: "👍" }));
  expect(
    await waitFor(async () => Object.keys(await channel.reactionSnapshot(msgSeq)).length === 0),
  ).toBe(true);
  await new Promise((r) => setTimeout(r, 600));
  aliceWs.close(1000, "done");
});

test("subscribe_thread frame delivers thread.reply, unsubscribe stops it", async () => {
  const aliceWs = await openWs("alice", "d-thread");
  aliceWs.send(
    JSON.stringify({ type: "subscribe_thread", channelId, parentId: rootId, subscribe: true }),
  );
  expect(await waitFor(() => threadSubscribed("alice"))).toBe(true);

  const first = collect(aliceWs, 3);
  const reply1 = await channel.postMessage("bob", {
    content: "first reply",
    parentId: rootId,
    clientToken: "ws-thread-reply-1",
  });
  expect(reply1).not.toHaveProperty("error");
  const events1 = await first;
  const hit1 = events1.find(
    (e) =>
      (e as { type?: string; event?: { type?: string } }).type === "channel.event" &&
      (e as { event: { type: string } }).event.type === "thread.reply",
  );
  expect(hit1).toBeDefined();
  expect(
    (hit1 as { event: { parentId: string; message: { content: string } } }).event,
  ).toMatchObject({
    parentId: rootId,
    message: { content: "first reply" },
  });

  aliceWs.send(
    JSON.stringify({ type: "subscribe_thread", channelId, parentId: rootId, subscribe: false }),
  );
  expect(await waitFor(() => threadSubscribed("alice").then((v) => !v))).toBe(true);

  const second = collect(aliceWs, 2);
  const reply2 = await channel.postMessage("bob", {
    content: "second reply",
    parentId: rootId,
    clientToken: "ws-thread-reply-2",
  });
  expect(reply2).not.toHaveProperty("error");
  const events2 = await second;
  const hit2 = events2.find(
    (e) =>
      (e as { type?: string; event?: { type?: string } }).type === "channel.event" &&
      (e as { event: { type: string } }).event.type === "thread.reply",
  );
  expect(hit2).toBeUndefined();
  aliceWs.close(1000, "done");
});
