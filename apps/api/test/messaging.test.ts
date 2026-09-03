import { expect, test } from "vite-plus/test";
import { env, runInDurableObject } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { channelDoName, issueInternalToken, userDoName } from "protocol";
import * as schema from "../src/db/schema-channel-do.ts";
import * as userSchema from "../src/db/schema-user-do.ts";

function channelStub(channelId: string) {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
}

async function setup(channelId: string, userIds: string[]) {
  const stub = channelStub(channelId);
  for (const userId of userIds) {
    await stub.membersAdd({ userId, role: "member" });
    await stub.setPresence({ userId, online: true });
  }
  return stub;
}

async function sidebarCacheFor(userId: string, channelId: string): Promise<unknown[]> {
  const stub = env.USER_DO.get(env.USER_DO.idFromName(userDoName(userId)));
  return runInDurableObject(stub, (instance) =>
    instance.db
      .select()
      .from(userSchema.sidebarCache)
      .where(eq(userSchema.sidebarCache.channelId, channelId))
      .all(),
  );
}

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(event as MessageEvent), { once: true });
  });
}

test("postMessage returns increasing seq with online members present", async () => {
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

test("message.new reaches online members and skips offline non-push members", async () => {
  const channelId = "c-online-target";
  const stub = channelStub(channelId);
  await stub.membersAdd({ userId: "alice", role: "member" });
  await stub.membersAdd({ userId: "bob", role: "member" });
  // Alice is online; bob is offline with no push subscription — emulates the
  // state after the channel DO hibernates and the persisted member_state is
  // the only source of truth.
  await stub.setPresence({ userId: "alice", online: true });

  const aliceDo = env.USER_DO.get(env.USER_DO.idFromName(userDoName("alice")));
  const token = await issueInternalToken({ subject: "user:alice", secret: env.INTERNAL_TOKEN_KEY });
  const up = await aliceDo.fetch(
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
  await stub.postMessage("bob", { content: "hi bob", clientToken: "h1" });
  const race = await Promise.race([
    pushed.then(() => "frame"),
    new Promise<string>((r) => setTimeout(() => r("timeout"), 500)),
  ]);
  expect(race).toBe("frame");

  // bob was never woken: his sidebar cache has no row for this channel.
  expect(await sidebarCacheFor("bob", channelId)).toEqual([]);
  ws.close(1000, "test done");
});

test("message.new still wakes offline push-subscribed members", async () => {
  const channelId = "c-push-target";
  const stub = channelStub(channelId);
  await stub.membersAdd({ userId: "alice", role: "member" });
  await stub.membersAdd({ userId: "bob", role: "member" });
  await stub.setPresence({ userId: "alice", online: true });
  await stub.setPushSubscribed({ userId: "bob", subscribed: true });
  await stub.setNotifPref({ userId: "bob", pref: "all" });

  await stub.postMessage("alice", { content: "push me", clientToken: "h2" });

  const cache = await sidebarCacheFor("bob", channelId);
  expect(cache).toHaveLength(1);
});

test("message.new skips offline members who opted out of notifications", async () => {
  const channelId = "c-push-none";
  const stub = channelStub(channelId);
  await stub.membersAdd({ userId: "alice", role: "member" });
  await stub.membersAdd({ userId: "bob", role: "member" });
  await stub.setPresence({ userId: "alice", online: true });
  await stub.setPushSubscribed({ userId: "bob", subscribed: true });
  await stub.setNotifPref({ userId: "bob", pref: "none" });

  await stub.postMessage("alice", { content: "do not push me", clientToken: "h3" });

  expect(await sidebarCacheFor("bob", channelId)).toEqual([]);
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
