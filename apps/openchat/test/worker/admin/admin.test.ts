import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { channelDoName } from "protocol";
import { getDb } from "../../../src/worker/db/client.ts";
import { users } from "../../../src/worker/db/schema-d1.ts";

async function signup(email: string, password: string): Promise<{ cookie: string; id: string }> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name: email.split("@")[0] }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie },
  });
  const { user } = (await me.json()) as { user: { id: string } };
  return { cookie, id: user.id };
}

async function makeAdmin(cookie: string, id: string) {
  await getDb(env.DB).update(users).set({ role: "admin" }).where(eq(users.id, id));
  return cookie;
}

async function createTeam(cookie: string, name: string, displayName: string) {
  const res = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name, displayName, type: "open" }),
  });
  return (await res.json()) as { id?: string; error?: string };
}

async function createChannel(cookie: string, teamId: string, name: string, displayName: string) {
  const res = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name, displayName, type: "public" }),
  });
  return (await res.json()) as { id?: string; error?: string };
}

let plainCookie = "";

beforeAll(async () => {
  plainCookie = (await signup("plain@test.dev", "admin-test-password")).cookie;
});

test("admin endpoint rejects unauthenticated", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/admin/settings");
  expect(res.status).toBe(401);
});

test("admin endpoint rejects non-admin", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/admin/settings", {
    headers: { cookie: plainCookie },
  });
  expect(res.status).toBe(403);
});

test("admin endpoint rejects bearer without session", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/admin/settings", {
    headers: { authorization: "Bearer invalid-token" },
  });
  expect(res.status).toBe(401);
});

interface StatsBody {
  users: number;
  teams: number;
  channels: number;
  messages: number;
  truncated: boolean;
}

let statsAdminCookie = "";
let statsAdminId = "";
let statsChannelId = "";

async function fetchStats(cookie?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return exports.default.fetch("http://localhost/api/v1/admin/stats", { headers });
}

beforeAll(async () => {
  const admin = await signup("stats-admin@test.dev", "admin-stats-password");
  statsAdminCookie = await makeAdmin(admin.cookie, admin.id);
  statsAdminId = admin.id;

  const team = await createTeam(statsAdminCookie, "stats", "Stats");
  const chan = await createChannel(statsAdminCookie, team.id!, "general", "General");
  statsChannelId = chan.id!;
});

test("admin stats returns aggregated counts", async () => {
  const res = await fetchStats(statsAdminCookie);
  expect(res.status).toBe(200);
  const body = (await res.json()) as StatsBody;
  expect(body.users).toBeGreaterThanOrEqual(1);
  expect(body.teams).toBeGreaterThanOrEqual(1);
  expect(body.channels).toBeGreaterThanOrEqual(1);
  expect(body.messages).toBeGreaterThanOrEqual(0);
  expect(body.truncated).toBe(false);
});

test("admin stats reflects posted messages", async () => {
  const stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(statsChannelId)));
  await stub.postMessage(statsAdminId, { content: "hello stats", clientToken: "stats-1" });

  const res = await fetchStats(statsAdminCookie);
  expect(res.status).toBe(200);
  const body = (await res.json()) as StatsBody;
  expect(body.messages).toBeGreaterThanOrEqual(1);
  expect(body.truncated).toBe(false);
});

test("admin stats rejects non-admin", async () => {
  const plain = await signup("stats-plain@test.dev", "admin-stats-password");
  const res = await fetchStats(plain.cookie);
  expect(res.status).toBe(403);
});

test("admin stats rejects no session", async () => {
  const res = await fetchStats();
  expect(res.status).toBe(401);
});

let structAdminCookie = "";
let archTeamId = "";
let archChannelId = "";
let remTeamId = "";

beforeAll(async () => {
  const admin = await signup("struct-admin@test.dev", "admin-struct-password");
  structAdminCookie = await makeAdmin(admin.cookie, admin.id);

  const archTeam = await createTeam(structAdminCookie, "arch", "Arch");
  archTeamId = archTeam.id!;
  const archChannel = await createChannel(structAdminCookie, archTeamId, "general", "General");
  archChannelId = archChannel.id!;

  const remTeam = await createTeam(structAdminCookie, "rem", "Rem");
  remTeamId = remTeam.id!;
});

test("channel archive by admin sets archivedAt", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/admin/channels/${archChannelId}/archive`,
    { method: "POST", headers: { cookie: structAdminCookie } },
  );
  expect(res.status).toBe(200);

  const detail = await exports.default.fetch(`http://localhost/api/v1/channels/${archChannelId}`, {
    headers: { cookie: structAdminCookie },
  });
  const body = (await detail.json()) as { channel: { archivedAt: number | null } };
  expect(body.channel.archivedAt).toBeTruthy();
});

test("team archive by admin sets archivedAt", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/admin/teams/${archTeamId}/archive`,
    {
      method: "POST",
      headers: { cookie: structAdminCookie },
    },
  );
  expect(res.status).toBe(200);

  const detail = await exports.default.fetch(`http://localhost/api/v1/teams/${archTeamId}`, {
    headers: { cookie: structAdminCookie },
  });
  const body = (await detail.json()) as { team: { archivedAt: number | null } };
  expect(body.team.archivedAt).toBeTruthy();
});

test("member remove drops team membership", async () => {
  const victim = await signup("rem-victim@test.dev", "admin-struct-password");
  const join = await exports.default.fetch(`http://localhost/api/v1/teams/${remTeamId}/members`, {
    method: "POST",
    headers: { cookie: victim.cookie, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(join.status).toBe(200);

  const remove = await exports.default.fetch(
    `http://localhost/api/v1/admin/teams/${remTeamId}/members/remove`,
    {
      method: "POST",
      headers: { cookie: structAdminCookie, "content-type": "application/json" },
      body: JSON.stringify({ userId: victim.id }),
    },
  );
  expect(remove.status).toBe(200);

  const list = await exports.default.fetch("http://localhost/api/v1/users/me/teams", {
    headers: { cookie: victim.cookie },
  });
  const body = (await list.json()) as { teams: { id: string }[] };
  expect(body.teams.map((t) => t.id)).not.toContain(remTeamId);
});

test("channel delete by admin returns 404 on fetch", async () => {
  const delTeam = await createTeam(structAdminCookie, "del", "Del");
  const delChannel = await createChannel(structAdminCookie, delTeam.id!, "general", "General");
  const res = await exports.default.fetch(
    `http://localhost/api/v1/admin/channels/${delChannel.id!}/delete`,
    { method: "POST", headers: { cookie: structAdminCookie } },
  );
  expect(res.status).toBe(200);

  const detail = await exports.default.fetch(`http://localhost/api/v1/channels/${delChannel.id!}`, {
    headers: { cookie: structAdminCookie },
  });
  expect(detail.status).toBe(404);
});

test("non-admin cannot archive", async () => {
  const plain = await signup("struct-plain@test.dev", "admin-struct-password");
  const res = await exports.default.fetch(
    `http://localhost/api/v1/admin/channels/${archChannelId}/archive`,
    { method: "POST", headers: { cookie: plain.cookie } },
  );
  expect(res.status).toBe(403);
});

test("no session returns 401", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/admin/teams/${archTeamId}/archive`,
    {
      method: "POST",
    },
  );
  expect(res.status).toBe(401);
});
