import { env, exports } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";
import { createChannelBroadcaster, createTeamBroadcaster } from "@worker/structure-broadcast";

async function signup(email: string, username: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "sb-test-password", name: username, username }),
  });
  return res.headers.get("set-cookie") ?? "";
}

async function userIdOf(cookie: string): Promise<string> {
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie },
  });
  return ((await me.json()) as { user: { id: string } }).user.id;
}

interface TestSocket {
  ws: WebSocket;
  read(): Promise<MessageEvent>;
}

async function upgrade(cookie: string, deviceId: string): Promise<TestSocket> {
  const tokenRes = await exports.default.fetch("http://localhost/api/auth/token", {
    headers: { cookie },
  });
  const { token } = (await tokenRes.json()) as { token: string };
  const res = await exports.default.fetch(
    new Request(`http://localhost/ws?deviceId=${deviceId}`, {
      headers: { Upgrade: "websocket", authorization: `Bearer ${token}` },
    }),
  );
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const queue: MessageEvent[] = [];
  let waiter: ((event: MessageEvent) => void) | null = null;
  ws.addEventListener("message", (event) => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(event as MessageEvent);
    } else {
      queue.push(event as MessageEvent);
    }
  });
  return {
    ws,
    read: () =>
      new Promise<MessageEvent>((resolve) => {
        const buffered = queue.shift();
        if (buffered) {
          resolve(buffered);
        } else {
          waiter = resolve;
        }
      }),
  };
}

function createTeamViaApi(cookie: string, name: string): Promise<{ id: string }> {
  return exports.default
    .fetch("http://localhost/api/v1/teams", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name, displayName: name, type: "open" }),
    })
    .then(async (res) => {
      expect(res.status).toBe(201);
      return (await res.json()) as { id: string };
    });
}

test("TeamBroadcaster delivers only to online members plus extra targets", async () => {
  const cookieA = await signup("sb-a@test.dev", "sba");
  const cookieB = await signup("sb-b@test.dev", "sbb");
  const cookieC = await signup("sb-c@test.dev", "sbc");
  const team = await createTeamViaApi(cookieA, "sb-team");
  for (const cookie of [cookieB, cookieC]) {
    const join = await exports.default.fetch(`http://localhost/api/v1/teams/${team.id}/members`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(join.status).toBe(200);
  }
  const a = await upgrade(cookieA, "sb-a-d1");
  const b = await upgrade(cookieB, "sb-b-d1");
  await a.read();
  await b.read();

  const removedId = await userIdOf(cookieC);
  const event = {
    type: "team.updated",
    team: { id: team.id, name: "sb-team", displayName: "SB", type: "open", archivedAt: null },
  } as const;
  await createTeamBroadcaster(env, team.id).broadcast(event, [removedId]);

  expect(JSON.parse(String((await a.read()).data))).toMatchObject({ type: "team.updated" });
  expect(JSON.parse(String((await b.read()).data))).toMatchObject({ type: "team.updated" });
  a.ws.close(1000, "done");
  b.ws.close(1000, "done");
});

test("ChannelBroadcaster delivers unwrapped event to channel members", async () => {
  const cookieA = await signup("sb-ca@test.dev", "sbca");
  const team = await createTeamViaApi(cookieA, "sb-ch-team");
  const chRes = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: cookieA, "content-type": "application/json" },
    body: JSON.stringify({ teamId: team.id, name: "sb-ch", displayName: "SB CH", type: "public" }),
  });
  expect(chRes.status).toBe(201);
  const { id: channelId } = (await chRes.json()) as { id: string };

  const a = await upgrade(cookieA, "sb-ca-d1");
  await a.read();
  await createChannelBroadcaster(env, channelId).broadcast({
    type: "channel.updated",
    channel: {
      id: channelId,
      teamId: team.id,
      name: "sb-ch",
      displayName: "SB CH",
      type: "public",
      member: true,
      archivedAt: 123,
    },
  });
  const frame = JSON.parse(String((await a.read()).data));
  expect(frame).toMatchObject({
    type: "channel.updated",
    channel: { id: channelId, archivedAt: 123 },
  });
  expect(frame.type).not.toBe("channel.event");
  a.ws.close(1000, "done");
});
