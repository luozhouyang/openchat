import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { channelDoName, issueInternalToken, userDoName } from "protocol";

function channelStub(channelId: string) {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
}

function userStub(userId: string) {
  return env.USER_DO.get(env.USER_DO.idFromName(userDoName(userId)));
}

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(event as MessageEvent), { once: true });
  });
}

async function upgrade(userId: string, deviceId: string): Promise<WebSocket> {
  const token = await issueInternalToken({
    subject: `user:${userId}`,
    secret: env.INTERNAL_TOKEN_KEY,
  });
  const up = await userStub(userId).fetch(
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

beforeAll(async () => {
  const stub = channelStub("c-hist");
  await stub.membersAdd({ userId: "u1", role: "member" });
  for (let i = 0; i < 5; i++) {
    const res = await stub.postMessage("u1", { content: `msg-${i}`, clientToken: `hist-${i}` });
    expect(res).not.toHaveProperty("error");
  }
});

test("history returns newest first", async () => {
  const body = await channelStub("c-hist").history({ limit: 3 });
  expect(body.messages.map((m) => m.content)).toEqual(["msg-4", "msg-3", "msg-2"]);
  expect(body.oldestSeq).toBe(body.messages[2]!.seq);
});

test("before_seq pagination has no overlap", async () => {
  const page1 = await channelStub("c-hist").history({ limit: 3 });
  const page2 = await channelStub("c-hist").history({
    limit: 3,
    beforeSeq: page1.oldestSeq!,
  });
  expect(page2.messages.map((m) => m.content)).toEqual(["msg-1", "msg-0"]);
  const seqs = [...page1.messages, ...page2.messages].map((m) => m.seq);
  expect(new Set(seqs).size).toBe(seqs.length);
});

test("after_seq catch-up returns everything past oldest", async () => {
  const all = await channelStub("c-hist").history({ limit: 10 });
  const tail = await channelStub("c-hist").history({
    afterSeq: all.oldestSeq!,
    limit: 10,
  });
  expect(tail.messages.length).toBe(all.messages.length - 1);
  expect(tail.messages.map((m) => m.content)).toEqual(["msg-4", "msg-3", "msg-2", "msg-1"]);
});

test("meta returns last_message keys", async () => {
  const metaMap = await channelStub("c-hist").meta();
  expect(Object.keys(metaMap).sort()).toEqual([
    "last_message_at",
    "last_message_id",
    "last_message_preview",
    "last_message_user_id",
  ]);
  expect(metaMap.last_message_user_id).toBe("u1");
  expect(metaMap.last_message_preview).toBe("msg-4");
});

test("sync frame returns sync.result with ascending messages", async () => {
  const channelId = "c-ws-sync";
  const stub = channelStub(channelId);
  await stub.membersAdd({ userId: "u1", role: "member" });
  await stub.postMessage("u1", { content: "sync-1", clientToken: "sync-1" });
  await stub.postMessage("u1", { content: "sync-2", clientToken: "sync-2" });
  const ws = await upgrade("u1", "d-sync");
  ws.send(JSON.stringify({ type: "sync", channels: [{ channelId, lastSeq: 0 }] }));
  const ev = await nextMessage(ws);
  const body = JSON.parse(String(ev.data)) as {
    type: string;
    channelId: string;
    messages: { content: string }[];
  };
  expect(body.type).toBe("sync.result");
  expect(body.channelId).toBe(channelId);
  expect(body.messages.map((m) => m.content)).toEqual(["sync-1", "sync-2"]);
  ws.close(1000, "done");
});
