import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { userDoName } from "protocol";
import { eq } from "drizzle-orm";
import { getDb } from "../../../src/worker/db/client.ts";
import { createChannel } from "../../../src/worker/db/repos/channels.ts";
import { roles } from "../../../src/worker/db/schema-d1.ts";
import { openDirect } from "../../../src/worker/services/channel.service.ts";

async function signup(email: string, password: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name: email.split("@")[0] }),
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

let ownerCookie = "";
let acmeId = "";

beforeAll(async () => {
  ownerCookie = await signup("owner@test.dev", "team-test-password");
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
  const joiner = await signup("joiner@test.dev", "team-test-password");

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

  const member = await signup("member@test.dev", "team-test-password");
  const withCode = await exports.default.fetch(`http://localhost/api/v1/teams/${invId}/members`, {
    method: "POST",
    headers: { cookie: member, "content-type": "application/json" },
    body: JSON.stringify({ inviteCode }),
  });
  expect(withCode.status).toBe(200);
});

test("non-member list returns empty", async () => {
  const outsider = await signup("outsider@test.dev", "team-test-password");
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
  const member = await signup("leaver@test.dev", "team-test-password");
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

let wsCookie = "";
let wsTeamId = "";

beforeAll(async () => {
  wsCookie = await signup("ws-guide@test.dev", "ws-guide-password");
  const res = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: wsCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "guideteam", displayName: "Guide Team", type: "open" }),
  });
  const body = (await res.json()) as { id?: string };
  wsTeamId = body.id!;
});

test("workspaces returns team with empty channels", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me/workspaces", {
    headers: { cookie: wsCookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    teams: {
      id: string;
      name: string;
      displayName: string;
      type: string;
      roles: string;
      archivedAt: number | null;
      channels: {
        id: string;
        teamId: string | null;
        name: string | null;
        displayName: string;
        type: string;
        member: boolean;
        archivedAt: number | null;
      }[];
    }[];
  };
  expect(body.teams).toHaveLength(1);
  expect(body.teams[0].name).toBe("guideteam");
  expect(body.teams[0].displayName).toBe("Guide Team");
  expect(body.teams[0].type).toBe("open");
  expect(body.teams[0].roles).toBe("team_admin");
  expect(body.teams[0].channels).toHaveLength(0);
});

test("workspaces lists channels and membership", async () => {
  const db = getDb(env.DB);
  await createChannel(db, {
    id: "channel-ws-1",
    teamId: wsTeamId,
    name: "general",
    displayName: "General",
    type: "public",
    dedupKey: "dedup-ws-1",
    creatorId: "user-ws-1",
  });

  const res = await exports.default.fetch("http://localhost/api/v1/users/me/workspaces", {
    headers: { cookie: wsCookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    teams: { id: string; channels: { id: string; name: string | null; member: boolean }[] }[];
  };
  expect(body.teams[0].channels).toHaveLength(1);
  expect(body.teams[0].channels[0].name).toBe("general");
  expect(body.teams[0].channels[0].member).toBe(false);

  await createChannel(db, {
    id: "channel-ws-2",
    teamId: wsTeamId,
    name: "announce",
    displayName: "Announce",
    type: "public",
    dedupKey: "dedup-ws-2",
    creatorId: "user-ws-1",
  });
  const res2 = await exports.default.fetch("http://localhost/api/v1/users/me/workspaces", {
    headers: { cookie: wsCookie },
  });
  const body2 = (await res2.json()) as {
    teams: { channels: { id: string; member: boolean }[] }[];
  };
  expect(body2.teams[0].channels).toHaveLength(2);
});

test("workspaces requires session", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me/workspaces");
  expect(res.status).toBe(401);
});

test("workspaces returns teamless dm channels as directs", async () => {
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie: wsCookie },
  });
  const { user } = (await me.json()) as { user: { id: string } };

  const other = await signup("ws-other@test.dev", "ws-guide-password");
  const otherMe = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie: other },
  });
  const { user: otherUser } = (await otherMe.json()) as { user: { id: string } };

  const db = getDb(env.DB);
  const opened = await openDirect(db, { userId: user.id, withUserId: otherUser.id });

  const res = await exports.default.fetch("http://localhost/api/v1/users/me/workspaces", {
    headers: { cookie: wsCookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    teams: unknown[];
    directs: {
      id: string;
      type: string;
      teamId: string | null;
      member: boolean;
      displayName: string;
    }[];
  };
  expect(body.directs).toHaveLength(1);
  expect(body.directs[0].id).toBe(opened.id);
  expect(body.directs[0].displayName).toBe("ws-other");
  expect(body.directs[0].type).toBe("dm");
  expect(body.directs[0].teamId).toBeNull();
  expect(body.directs[0].member).toBe(true);
});

test("create team requires create_team permission", async () => {
  const db = getDb(env.DB);
  const [systemUser] = await db.select().from(roles).where(eq(roles.name, "system_user")).limit(1);
  expect(systemUser).toBeTruthy();
  const orig = systemUser!.permissions;
  await db
    .update(roles)
    .set({ permissions: JSON.stringify([]) })
    .where(eq(roles.name, "system_user"));
  try {
    const res = await exports.default.fetch("http://localhost/api/v1/teams", {
      method: "POST",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "nopermteam", displayName: "No Perm", type: "open" }),
    });
    expect(res.status).toBe(403);
  } finally {
    await db.update(roles).set({ permissions: orig }).where(eq(roles.name, "system_user"));
  }
});
