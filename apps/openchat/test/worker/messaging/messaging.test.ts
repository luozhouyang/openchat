import { expect, test } from "vite-plus/test";
import { env, runInDurableObject } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { channelDoName, issueInternalToken, userDoName } from "protocol";
import * as schema from "../../../src/worker/db/schema-channel-do.ts";
import * as userSchema from "../../../src/worker/db/schema-user-do.ts";

function channelStub(channelId: string) {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
}

async function setup(channelId: string, userIds: string[]) {
  const stub = channelStub(channelId);
  for (const userId of userIds) {
    await stub.membersAdd({ userId, role: "member" });
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

test("postMessage returns increasing seq for members", async () => {
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

test("message.new in a large channel reaches online members and skips offline non-push members", async () => {
  const channelId = "c-online-target";
  const stub = channelStub(channelId);
  // 18 members > SMALL_CHANNEL_THRESHOLD (16): the broadcast filter runs through
  // D1 `user_status`, not the per-channel member_state.
  const filler = Array.from({ length: 16 }, (_, i) => `filler-${i}`);
  for (const uid of ["alice", "bob", ...filler]) {
    await stub.membersAdd({ userId: uid, role: "member" });
  }

  // Alice connects (UserDO writes online=true to D1); bob is offline with no
  // push subscription — emulates the state after the channel DO hibernates and
  // the persisted member_state is the only local source of truth.
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
  await stub.setPushSubscribed({ userId: "bob", subscribed: true });
  await stub.setNotifPref({ userId: "bob", pref: "all" });

  await stub.postMessage("alice", { content: "push me", clientToken: "h2" });

  const cache = await sidebarCacheFor("bob", channelId);
  expect(cache).toHaveLength(1);
});

test("message.new skips offline opted-out members in a large channel", async () => {
  const channelId = "c-push-none";
  const stub = channelStub(channelId);
  const filler = Array.from({ length: 16 }, (_, i) => `filler-${i}`);
  for (const uid of ["alice", "bob", ...filler]) {
    await stub.membersAdd({ userId: uid, role: "member" });
  }
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

function idemStub() {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName("c-idem")));
}

test("message gets seq and duplicate token returns same seq with deduplicated", async () => {
  const stub = idemStub();
  await stub.membersAdd({ userId: "u1", role: "member" });
  const first = await stub.postMessage("u1", { content: "hello", clientToken: "tok-1" });
  expect(first).not.toHaveProperty("error");
  const r1 = first as { messageId: string; seq: number };
  const second = await stub.postMessage("u1", { content: "hello", clientToken: "tok-1" });
  const r2 = second as { messageId: string; seq: number; deduplicated?: boolean };
  expect(r2.seq).toBe(r1.seq);
  expect(r2.messageId).toBe(r1.messageId);
  expect(r2.deduplicated).toBe(true);
});

test("non-member rejected with 403 semantics", async () => {
  const stub = idemStub();
  const res = await stub.postMessage("stranger", { content: "hi", clientToken: "tok-x" });
  expect(res).toEqual({ error: "not a member", status: 403 });
});

test("oversized content rejected with 422 semantics", async () => {
  const stub = idemStub();
  await stub.membersAdd({ userId: "u1", role: "member" });
  const res = await stub.postMessage("u1", { content: "x".repeat(17000), clientToken: "tok-big" });
  expect(res).toEqual({ error: "invalid", status: 422 });
});
