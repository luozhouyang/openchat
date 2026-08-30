import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { channelDoName, issueInternalToken, userDoName } from "protocol";

const channelId = "c-typing";
const channel = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));

beforeAll(async () => {
  await channel.membersAdd({ userId: "alice", role: "member" });
  await channel.membersAdd({ userId: "bob", role: "member" });
  const sub = await channel.subscribe({ userId: "bob" });
  expect(sub.ok).toBe(true);
});

test("typing by member is silent, non-member rejected", async () => {
  expect(await channel.typing("alice")).toBeUndefined();
  expect(await channel.typing("ghost")).toEqual({ error: "not a member", status: 403 });
});

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(event as MessageEvent), { once: true });
  });
}

async function openWs(userId: string): Promise<WebSocket> {
  const userDo = env.USER_DO.get(env.USER_DO.idFromName(userDoName(userId)));
  const token = await issueInternalToken({
    subject: `user:${userId}`,
    secret: env.INTERNAL_TOKEN_KEY,
  });
  const up = await userDo.fetch(
    new Request(`http://user-do/ws?deviceId=d1&sub=${userId}`, {
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

test("typing frame broadcasts typing.start, throttled to one per 3s", async () => {
  const bobWs = await openWs("bob");
  const aliceWs = await openWs("alice");

  const first = nextMessage(bobWs);
  aliceWs.send(JSON.stringify({ type: "typing", channelId }));
  const ev1 = JSON.parse(String((await first).data)) as {
    type: string;
    channelId: string;
    event: { type: string; userId: string; expiresAt: number };
  };
  expect(ev1).toEqual({
    type: "channel.event",
    channelId,
    event: { type: "typing.start", userId: "alice", expiresAt: expect.any(Number) },
  });

  aliceWs.send(JSON.stringify({ type: "typing", channelId }));
  const second = await Promise.race([
    nextMessage(bobWs).then((e) => JSON.parse(String(e.data))),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 400)),
  ]);
  expect(second).toBeNull();

  bobWs.close(1000, "done");
  aliceWs.close(1000, "done");
});
