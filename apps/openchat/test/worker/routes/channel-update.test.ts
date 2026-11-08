import { exports } from "cloudflare:workers";
import { beforeAll, expect, test } from "vite-plus/test";

let adminCookie = "";
let memberCookie = "";
let channelId = "";
let teamId = "";

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "channel-update-password",
      name: email.split("@")[0],
      username: email.split("@")[0],
    }),
  });
  return res.headers.get("set-cookie") ?? "";
}

async function update(cookie: string, body: Record<string, unknown>) {
  const res = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as { channel?: { displayName: string; purpose: string | null } },
  };
}

beforeAll(async () => {
  adminCookie = await signup("channel-admin@test.dev");
  memberCookie = await signup("channel-member@test.dev");
  const team = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "updco", displayName: "UpdCo", type: "open" }),
  });
  teamId = ((await team.json()) as { id: string }).id;
  const channel = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name: "upd", displayName: "Upd", type: "public" }),
  });
  channelId = ((await channel.json()) as { id: string }).id;
  await exports.default.fetch(`http://localhost/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: { cookie: memberCookie, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/members`, {
    method: "POST",
    headers: { cookie: memberCookie },
  });
});

test("channel admin updates name and purpose", async () => {
  const { status, body } = await update(adminCookie, {
    displayName: "Renamed",
    purpose: "Team updates",
  });
  expect(status).toBe(200);
  expect(body.channel?.displayName).toBe("Renamed");

  const detail = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}`, {
    headers: { cookie: adminCookie },
  });
  const parsed = (await detail.json()) as { channel: { displayName: string; purpose: string } };
  expect(parsed.channel.displayName).toBe("Renamed");
  expect(parsed.channel.purpose).toBe("Team updates");
});

test("regular members cannot rename the channel", async () => {
  const { status } = await update(memberCookie, { displayName: "Hijacked" });
  expect(status).toBe(403);
});

test("empty display names are rejected", async () => {
  const { status } = await update(adminCookie, { displayName: "" });
  expect(status).toBe(422);
});
