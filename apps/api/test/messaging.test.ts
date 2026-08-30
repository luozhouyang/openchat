import { expect, test } from "vite-plus/test";
import { env, runInDurableObject } from "cloudflare:test";
import { channelDoName, issueInternalToken, userDoName } from "protocol";
import * as schema from "../src/db/schema-channel-do.ts";

function channelStub(channelId: string) {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
}

async function setup(channelId: string, userIds: string[]) {
  const stub = channelStub(channelId);
  for (const userId of userIds) {
    await stub.membersAdd({ userId, role: "member" });
    const sub = await stub.subscribe({ userId });
    expect(sub.ok).toBe(true);
  }
  return stub;
}

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(event as MessageEvent), { once: true });
  });
}

test("postMessage returns increasing seq with subscribers present", async () => {
  const stub = await setup("c-msg-seq", ["alice", "bob"]);
  const first = await stub.postMessage("alice", { content: "hello bob", clientToken: "s1" });
  expect(first).toMatchObject({ messageId: expect.any(String), seq: 1 });
  const second = await stub.postMessage("bob", { content: "hi alice", clientToken: "s2" });
  expect(second).toMatchObject({ messageId: expect.any(String), seq: 2 });
});

test("broadcast delivers channel event to subscriber websocket", async () => {
  const channelId = "c-msg-ws";
  const stub = await setup(channelId, ["alice", "bob"]);
  const bobDo = env.USER_DO.get(env.USER_DO.idFromName(userDoName("bob")));
  const token = await issueInternalToken({ subject: "user:bob", secret: env.INTERNAL_TOKEN_KEY });
  const up = await bobDo.fetch(
    new Request("http://user-do/ws?deviceId=d1", {
      headers: { Upgrade: "websocket", "x-internal-token": token },
    }),
  );
  expect(up.status).toBe(101);
  const ws = up.webSocket!;
  ws.accept();
  const hello = await nextMessage(ws);
  expect(JSON.parse(String(hello.data))).toMatchObject({ type: "hello" });

  const pushed = nextMessage(ws);
  await stub.postMessage("alice", { content: "hello bob", clientToken: "w1" });
  const event = await pushed;
  expect(JSON.parse(String(event.data))).toEqual({
    type: "channel.event",
    channelId,
    event: { type: "message.new", message: expect.anything() },
  });
  ws.close(1000, "test done");
});

test("postMessage updates meta last_message keys", async () => {
  const stub = await setup("c-msg-meta", ["alice"]);
  await stub.postMessage("alice", { content: "hello meta", clientToken: "m1" });
  const rows = await runInDurableObject(stub, (instance) =>
    instance.db.select().from(schema.meta).all(),
  );
  const metaMap = new Map(rows.map((r) => [r.key, r.value]));
  expect(metaMap.get("last_message_id")).toBeTruthy();
  expect(metaMap.get("last_message_user_id")).toBe("alice");
  expect(metaMap.get("last_message_preview")).toBe("hello meta");
  expect(Number(metaMap.get("last_message_at"))).toBeGreaterThan(0);
});
