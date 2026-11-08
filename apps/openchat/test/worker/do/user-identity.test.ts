import { env } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";
import { issueInternalToken, userDoName } from "protocol";

// Real id format `usr_<uuidv7>`; the DO name binding must be checked, not the
// token alone.
const userId = "usr_u0000000-9a8b-7c6d-5e4f-3a2b1c0d9e8f";

const userDo = () => env.USER_DO.get(env.USER_DO.idFromName(userDoName(userId)));

async function upgrade(query: string, subject: string): Promise<Response> {
  const token = await issueInternalToken({
    subject: `user:${subject}`,
    secret: env.INTERNAL_TOKEN_KEY,
  });
  return userDo().fetch(
    new Request(`http://user-do/ws?${query}`, {
      headers: { Upgrade: "websocket", "x-internal-token": token },
    }),
  );
}

test("upgrade with a token issued for another user is rejected", async () => {
  const res = await upgrade("deviceId=d-identity-1", "someone-else");
  expect(res.status).toBe(403);
});

test("upgrade with mismatching `sub` query param is rejected", async () => {
  const res = await upgrade(
    `deviceId=d-identity-2&sub=someone-else`,
    "usr_u0000000-9a8b-7c6d-5e4f-3a2b1c0d9e8f",
  );
  expect(res.status).toBe(403);
});

test("upgrade with matching subject and sub binds attachment identity to DO name", async () => {
  const okRes = await upgrade(
    `deviceId=d-identity-3&platform=web&sub=${encodeURIComponent(userId)}`,
    userId,
  );
  expect(okRes.status).toBe(101);
  const ws = okRes.webSocket!;
  ws.accept();
  const hello = await new Promise<MessageEvent>((resolve) => {
    ws.addEventListener("message", (event) => resolve(event as MessageEvent), { once: true });
  });
  expect(JSON.parse(String(hello.data))).toMatchObject({
    type: "hello",
    userId,
  });
  ws.close(1000, "done");
});
