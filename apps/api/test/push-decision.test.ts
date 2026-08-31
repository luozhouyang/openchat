import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { userDoName } from "protocol";

let aliceCookie = "";
let aliceId = "";
let channelId = "";

beforeAll(async () => {
  const signupAlice = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "alice@push-decision.dev",
      password: "push-decision-test-password",
      name: "Alice",
    }),
  });
  aliceCookie = signupAlice.headers.get("set-cookie") ?? "";
  const tokenAlice = await exports.default.fetch("http://localhost/api/auth/token", {
    headers: { cookie: aliceCookie },
  });
  aliceId = jwtSubject(((await tokenAlice.json()) as { token: string }).token);

  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: aliceCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "pd", displayName: "PD", type: "open" }),
  });
  const teamId = ((await team.json()) as { id: string }).id;
  const create = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: aliceCookie, "content-type": "application/json" },
    body: JSON.stringify({
      teamId,
      name: "general",
      displayName: "General",
      type: "public",
    }),
  });
  channelId = ((await create.json()) as { id: string }).id;
});

function jwtSubject(token: string): string {
  const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
    sub: string;
  };
  return payload.sub;
}

function userStub() {
  return env.USER_DO.get(env.USER_DO.idFromName(userDoName(aliceId)));
}

async function subscribe() {
  return exports.default.fetch("http://localhost/api/v1/users/me/push_subscriptions", {
    method: "POST",
    headers: { cookie: aliceCookie, "content-type": "application/json" },
    body: JSON.stringify({
      deviceId: "d1",
      kind: "webpush",
      endpoint: "https://push.example/ep1",
      p256dh: "pk",
      auth: "au",
    }),
  });
}

async function push(events: unknown[]) {
  return userStub().push({ channelId, events });
}

test("subscribing an endpoint allows push decision to reach enqueue", async () => {
  const res = await subscribe();
  expect(res.status).toBe(200);

  const base = {
    type: "message.new",
    message: { id: "m1", content: "hello", mentions: [] },
    notifPref: "all",
  };
  await expect(push([base])).resolves.toBeUndefined();

  await expect(push([{ ...base, notifPref: "none" }])).resolves.toBeUndefined();
  await expect(
    push([
      {
        ...base,
        message: { id: "m2", content: "no mention", mentions: [] },
        notifPref: "mention",
      },
    ]),
  ).resolves.toBeUndefined();
  await expect(
    push([
      {
        ...base,
        message: { id: "m3", content: "hi @alice", mentions: [aliceId] },
        notifPref: "mention",
      },
    ]),
  ).resolves.toBeUndefined();

  await expect(push([base])).resolves.toBeUndefined();
});

test("push decision resolves for other event types", async () => {
  await expect(
    push([{ type: "channel.read", channelId, lastReadSeq: 1 }]),
  ).resolves.toBeUndefined();
  await expect(push([{ type: "typing.start", userId: "bob" }])).resolves.toBeUndefined();
});
