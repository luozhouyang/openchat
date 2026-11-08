import { env, exports } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";
import { issueInternalToken, userDoName } from "protocol";
import { signup, userIdOf } from "../helpers/setup.ts";

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(event as MessageEvent), { once: true });
  });
}

test("message.new carries the channel display name for push titles", async () => {
  const cookie = await signup(exports.default, "push-title@test.dev", "test-password", "Push");
  const userId = await userIdOf(exports.default, cookie);

  const teamRes = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "push-team", displayName: "Push Team", type: "open" }),
  });
  const teamId = ((await teamRes.json()) as { id: string }).id;
  const channelRes = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      teamId,
      name: "push-channel",
      displayName: "Push Channel",
      type: "public",
    }),
  });
  const channelId = ((await channelRes.json()) as { id: string }).id;

  const userDo = env.USER_DO.get(env.USER_DO.idFromName(userDoName(userId)));
  const token = await issueInternalToken({
    subject: `user:${userId}`,
    secret: env.INTERNAL_TOKEN_KEY,
  });
  const up = await userDo.fetch(
    new Request("http://user-do/ws?deviceId=d1", {
      headers: { Upgrade: "websocket", "x-internal-token": token },
    }),
  );
  expect(up.status).toBe(101);
  const ws = up.webSocket!;
  ws.accept();
  await nextMessage(ws);

  const pushed = nextMessage(ws);
  const postRes = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/posts`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ message: "with a name", clientToken: crypto.randomUUID() }),
    },
  );
  expect(postRes.status).toBe(201);

  const frame = JSON.parse(String((await pushed).data)) as {
    type: string;
    event: { type: string; channelDisplayName?: string };
  };
  expect(frame.type).toBe("channel.event");
  expect(frame.event.type).toBe("message.new");
  expect(frame.event.channelDisplayName).toBe("Push Channel");
  ws.close(1000, "test done");
});
