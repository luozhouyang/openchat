import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";

let adminCookie = "";
let adminId = "";
let archTeamId = "";
let archChannelId = "";
let remTeamId = "";

async function signup(email: string): Promise<{ cookie: string; id: string }> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "admin-struct-password", name: email.split("@")[0] }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie },
  });
  const { user } = (await me.json()) as { user: { id: string } };
  return { cookie, id: user.id };
}

async function createTeam(cookie: string, name: string, displayName: string) {
  const res = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name, display_name: displayName, type: "open" }),
  });
  return (await res.json()) as { id?: string; error?: string };
}

async function createChannel(cookie: string, teamId: string, name: string, displayName: string) {
  const res = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ team_id: teamId, name, display_name: displayName, type: "public" }),
  });
  return (await res.json()) as { id?: string; error?: string };
}

beforeAll(async () => {
  const admin = await signup("struct-admin@test.dev");
  adminCookie = admin.cookie;
  adminId = admin.id;
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(adminId).run();

  const archTeam = await createTeam(adminCookie, "arch", "Arch");
  archTeamId = archTeam.id!;
  const archChannel = await createChannel(adminCookie, archTeamId, "general", "General");
  archChannelId = archChannel.id!;

  const remTeam = await createTeam(adminCookie, "rem", "Rem");
  remTeamId = remTeam.id!;
});

test("channel archive by admin sets archivedAt", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/admin/channels/${archChannelId}/archive`,
    { method: "POST", headers: { cookie: adminCookie } },
  );
  expect(res.status).toBe(200);

  const detail = await exports.default.fetch(`http://localhost/api/v1/channels/${archChannelId}`, {
    headers: { cookie: adminCookie },
  });
  const body = (await detail.json()) as { archivedAt: number | null };
  expect(body.archivedAt).toBeTruthy();
});

test("team archive by admin sets archivedAt", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/admin/teams/${archTeamId}/archive`,
    {
      method: "POST",
      headers: { cookie: adminCookie },
    },
  );
  expect(res.status).toBe(200);

  const detail = await exports.default.fetch(`http://localhost/api/v1/teams/${archTeamId}`, {
    headers: { cookie: adminCookie },
  });
  const body = (await detail.json()) as { team: { archivedAt: number | null } };
  expect(body.team.archivedAt).toBeTruthy();
});

test("member remove drops team membership", async () => {
  const victim = await signup("rem-victim@test.dev");
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
      headers: { cookie: adminCookie, "content-type": "application/json" },
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
  const delTeam = await createTeam(adminCookie, "del", "Del");
  const delChannel = await createChannel(adminCookie, delTeam.id!, "general", "General");
  const res = await exports.default.fetch(
    `http://localhost/api/v1/admin/channels/${delChannel.id!}/delete`,
    { method: "POST", headers: { cookie: adminCookie } },
  );
  expect(res.status).toBe(200);

  const detail = await exports.default.fetch(`http://localhost/api/v1/channels/${delChannel.id!}`, {
    headers: { cookie: adminCookie },
  });
  expect(detail.status).toBe(404);
});

test("non-admin cannot archive", async () => {
  const plain = await signup("struct-plain@test.dev");
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
