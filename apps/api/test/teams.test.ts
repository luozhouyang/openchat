import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { userDoName } from "protocol";
import { getDb } from "../src/db/client.ts";
import { createChannel } from "../src/db/repos/channels.ts";

let ownerCookie = "";
let acmeId = "";

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "team-test-password", name: email.split("@")[0] }),
  });
  return res.headers.get("set-cookie") ?? "";
}

async function createTeam(
  cookie: string,
  name: string,
  displayName: string,
  type: "open" | "invite",
) {
  const res = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name, displayName, type }),
  });
  return {
    status: res.status,
    body: (await res.json()) as { id?: string; inviteCode?: string; error?: string },
  };
}

beforeAll(async () => {
  ownerCookie = await signup("owner@test.dev");
});

test("create and list team", async () => {
  const create = await createTeam(ownerCookie, "acme", "Acme", "open");
  expect(create.status).toBe(201);
  expect(create.body.id).toBeTruthy();
  acmeId = create.body.id!;

  const list = await exports.default.fetch("http://localhost/api/v1/users/me/teams", {
    headers: { cookie: ownerCookie },
  });
  const body = (await list.json()) as { teams: { id: string; name: string; roles: string }[] };
  expect(body.teams.map((t) => t.name)).toContain("acme");
  expect(body.teams.find((t) => t.name === "acme")?.roles).toBe("team_admin");
});

test("open team joinable, invite team needs code", async () => {
  const joiner = await signup("joiner@test.dev");

  const openJoin = await exports.default.fetch(`http://localhost/api/v1/teams/${acmeId}/members`, {
    method: "POST",
    headers: { cookie: joiner, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(openJoin.status).toBe(200);

  const inv = await createTeam(ownerCookie, "secret", "Secret", "invite");
  expect(inv.status).toBe(201);
  const invId = inv.body.id!;

  const noCode = await exports.default.fetch(`http://localhost/api/v1/teams/${invId}/members`, {
    method: "POST",
    headers: { cookie: joiner, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(noCode.status).toBe(403);

  const wrongCode = await exports.default.fetch(`http://localhost/api/v1/teams/${invId}/members`, {
    method: "POST",
    headers: { cookie: joiner, "content-type": "application/json" },
    body: JSON.stringify({ inviteCode: "bogus-code" }),
  });
  expect(wrongCode.status).toBe(403);
});

test("admin detail exposes team and join with invite code works", async () => {
  const inv = await createTeam(ownerCookie, "vault", "Vault", "invite");
  const invId = inv.body.id!;
  const inviteCode = inv.body.inviteCode!;
  expect(inviteCode).toBeTruthy();

  const detail = await exports.default.fetch(`http://localhost/api/v1/teams/${invId}`, {
    headers: { cookie: ownerCookie },
  });
  expect(detail.status).toBe(200);
  const { team } = (await detail.json()) as { team: { id: string; name: string; type: string } };
  expect(team.id).toBe(invId);
  expect(team.name).toBe("vault");
  expect(team.type).toBe("invite");

  const member = await signup("member@test.dev");
  const withCode = await exports.default.fetch(`http://localhost/api/v1/teams/${invId}/members`, {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({ inviteCode }),
  });
  expect(withCode.status).toBe(200);
});

test("non-member list returns empty", async () => {
  const outsider = await signup("outsider@test.dev");
  const list = await exports.default.fetch("http://localhost/api/v1/users/me/teams", {
    headers: { cookie: outsider },
  });
  const body = (await list.json()) as { teams: unknown[] };
  expect(body.teams).toHaveLength(0);
});

test("sole admin cannot leave team", async () => {
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie: ownerCookie },
  });
  const { user } = (await me.json()) as { user: { id: string } };
  const leave = await exports.default.fetch(
    `http://localhost/api/v1/teams/${acmeId}/members/${user.id}`,
    { method: "DELETE", headers: { cookie: ownerCookie } },
  );
  expect(leave.status).toBe(409);
});

test("leave syncs user channels via UserDO rpc", async () => {
  const member = await signup("leaver@test.dev");
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie: member },
  });
  const { user } = (await me.json()) as { user: { id: string } };

  const join = await exports.default.fetch(`http://localhost/api/v1/teams/${acmeId}/members`, {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(join.status).toBe(200);

  const db = getDb(env.DB);
  await createChannel(db, {
    id: "channel-leave-1",
    teamId: acmeId,
    name: "general",
    displayName: "General",
    type: "public",
    dedupKey: "dedup-leave-1",
    creatorId: user.id,
  });

  const leave = await exports.default.fetch(
    `http://localhost/api/v1/teams/${acmeId}/members/${user.id}`,
    { method: "DELETE", headers: { cookie: member } },
  );
  expect(leave.status).toBe(200);

  const stub = env.USER_DO.idFromName(userDoName(user.id));
  const health = await env.USER_DO.get(stub).health();
  expect(health.channels).toBe(1);

  const list = await exports.default.fetch("http://localhost/api/v1/users/me/teams", {
    headers: { cookie: member },
  });
  const body = (await list.json()) as { teams: unknown[] };
  expect(body.teams).toHaveLength(0);
});
