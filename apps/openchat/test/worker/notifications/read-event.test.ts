import { env, exports } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";
import { issueInternalToken, userDoName } from "protocol";
import { signup, userIdOf } from "../helpers/setup.ts";

function nextMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (event) => resolve(event as MessageEvent), { once: true });
  });
}

test("marking notifications read reaches the user's other devices", async () => {
  const cookie = await signup(exports.default, "read-event@test.dev", "test-password", "Read");
  const userId = await userIdOf(exports.default, cookie);

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
  const read = await exports.default.fetch("http://localhost/api/v1/users/me/notifications/read", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(read.status).toBe(200);

  const frame = JSON.parse(String((await pushed).data)) as { type: string };
  expect(frame.type).toBe("notifications.read");
  ws.close(1000, "test done");
});
