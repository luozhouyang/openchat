import { exports } from "cloudflare:workers";
import { beforeAll, expect, test } from "vite-plus/test";

let memberCookie = "";
let outsiderCookie = "";
let channelId = "";

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "notify-test-password",
      name: email.split("@")[0],
      username: email.split("@")[0],
    }),
  });
  return res.headers.get("set-cookie") ?? "";
}

async function getPref(cookie: string) {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/notifyProps`,
    {
      headers: { cookie },
    },
  );
  return {
    status: res.status,
    body: (await res.json()) as { notifyProps?: { pref: string } },
  };
}

beforeAll(async () => {
  memberCookie = await signup("notify-member@test.dev");
  outsiderCookie = await signup("notify-outsider@test.dev");
  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: memberCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "notifyco", displayName: "NotifyCo", type: "open" }),
  });
  const teamId = ((await team.json()) as { id: string }).id;
  const channel = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: memberCookie, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name: "notify", displayName: "Notify", type: "public" }),
  });
  channelId = ((await channel.json()) as { id: string }).id;
});

test("defaults to all notifications", async () => {
  const { status, body } = await getPref(memberCookie);
  expect(status).toBe(200);
  expect(body.notifyProps?.pref).toBe("all");
});

test("updates the preference and reads it back", async () => {
  const put = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/members/me/notifyProps`,
    {
      method: "PUT",
      headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ notifyProps: { pref: "mention" } }),
    },
  );
  expect(put.status).toBe(200);
  const { body } = await getPref(memberCookie);
  expect(body.notifyProps?.pref).toBe("mention");
});

test("rejects invalid preferences", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/members/me/notifyProps`,
    {
      method: "PUT",
      headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ notifyProps: { pref: "sometimes" } }),
    },
  );
  expect(res.status).toBe(422);
});

test("non-members cannot read the preference", async () => {
  const { status } = await getPref(outsiderCookie);
  expect(status).toBe(403);
});
