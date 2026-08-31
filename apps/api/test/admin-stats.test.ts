import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { channelDoName } from "protocol";

let adminCookie = "";
let adminId = "";
let channelId = "";

interface StatsBody {
  users: number;
  teams: number;
  channels: number;
  messages: number;
  truncated: boolean;
}

async function signup(email: string): Promise<{ cookie: string; id: string }> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "admin-stats-password", name: email.split("@")[0] }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie },
  });
  const { user } = (await me.json()) as { user: { id: string } };
  return { cookie, id: user.id };
}

async function fetchStats(cookie?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return exports.default.fetch("http://localhost/api/v1/admin/stats", { headers });
}

beforeAll(async () => {
  const admin = await signup("stats-admin@test.dev");
  adminCookie = admin.cookie;
  adminId = admin.id;
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(adminId).run();

  const teamRes = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "stats", display_name: "Stats", type: "open" }),
  });
  const team = (await teamRes.json()) as { id: string };
  const chanRes = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    body: JSON.stringify({
      team_id: team.id,
      name: "general",
      display_name: "General",
      type: "public",
    }),
  });
  const chan = (await chanRes.json()) as { id: string };
  channelId = chan.id;
});

test("admin stats returns aggregated counts", async () => {
  const res = await fetchStats(adminCookie);
  expect(res.status).toBe(200);
  const body = (await res.json()) as StatsBody;
  expect(body.users).toBeGreaterThanOrEqual(1);
  expect(body.teams).toBeGreaterThanOrEqual(1);
  expect(body.channels).toBeGreaterThanOrEqual(1);
  expect(body.messages).toBeGreaterThanOrEqual(0);
  expect(body.truncated).toBe(false);
});

test("admin stats reflects posted messages", async () => {
  const stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
  await stub.postMessage(adminId, { content: "hello stats", clientToken: "stats-1" });

  const res = await fetchStats(adminCookie);
  expect(res.status).toBe(200);
  const body = (await res.json()) as StatsBody;
  expect(body.messages).toBeGreaterThanOrEqual(1);
  expect(body.truncated).toBe(false);
});

test("admin stats rejects non-admin", async () => {
  const plain = await signup("stats-plain@test.dev");
  const res = await fetchStats(plain.cookie);
  expect(res.status).toBe(403);
});

test("admin stats rejects no session", async () => {
  const res = await fetchStats();
  expect(res.status).toBe(401);
});
