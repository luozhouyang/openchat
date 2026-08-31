import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";

let aliceCookie = "";
let teamId = "";
let knownToken = "known-token";
let createdInviteId = "";
let knownInserted = false;

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "invite-test-password", name: email.split("@")[0] }),
  });
  return res.headers.get("set-cookie") ?? "";
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function insertInvite(
  id: string,
  tokenHash: string,
  email: string,
  createdAt: number,
  expiresAt: number,
) {
  await env.DB.prepare(
    "INSERT INTO invites (id, team_id, token_hash, email, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, teamId, tokenHash, email, "alice-inviter", createdAt, expiresAt)
    .run();
}

async function accept(cookie: string, token: string) {
  return exports.default.fetch("http://localhost/teams/invites/accept", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

beforeAll(async () => {
  aliceCookie = await signup("alice@test.dev");
  const create = await exports.default.fetch("http://localhost/teams", {
    method: "POST",
    headers: { cookie: aliceCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "invteam", displayName: "Inv", type: "open" }),
  });
  const body = (await create.json()) as { id: string };
  teamId = body.id;
});

test("admin creates invite, response has no token", async () => {
  const res = await exports.default.fetch(`http://localhost/teams/${teamId}/invites`, {
    method: "POST",
    headers: { cookie: aliceCookie, "content-type": "application/json" },
    body: JSON.stringify({ email: "bob@test.dev" }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string; email: string; token?: string };
  expect(body.id).toBeTruthy();
  expect(body.email).toBe("bob@test.dev");
  expect(body.token).toBeUndefined();
  createdInviteId = body.id;
});

test("duplicate pending invite is 409", async () => {
  const res = await exports.default.fetch(`http://localhost/teams/${teamId}/invites`, {
    method: "POST",
    headers: { cookie: aliceCookie, "content-type": "application/json" },
    body: JSON.stringify({ email: "bob@test.dev" }),
  });
  expect(res.status).toBe(409);
});

test("invalid email is 422", async () => {
  const res = await exports.default.fetch(`http://localhost/teams/${teamId}/invites`, {
    method: "POST",
    headers: { cookie: aliceCookie, "content-type": "application/json" },
    body: JSON.stringify({ email: "not-an-email" }),
  });
  expect(res.status).toBe(422);
});

test("admin lists invites including the created one", async () => {
  const res = await exports.default.fetch(`http://localhost/teams/${teamId}/invites`, {
    headers: { cookie: aliceCookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    invites: { id: string; email: string; expiresAt: number }[];
  };
  expect(body.invites.some((i) => i.id === createdInviteId)).toBe(true);
});

test("non-admin member cannot create invite", async () => {
  const carol = await signup("carol@test.dev");
  const me = await exports.default.fetch("http://localhost/me", {
    headers: { cookie: carol },
  });
  const { user } = (await me.json()) as { user: { id: string } };
  await env.DB.prepare(
    "INSERT INTO team_members (team_id, user_id, roles, joined_at) VALUES (?, ?, 'team_user', ?)",
  )
    .bind(teamId, user.id, Date.now())
    .run();
  const res = await exports.default.fetch(`http://localhost/teams/${teamId}/invites`, {
    method: "POST",
    headers: { cookie: carol, "content-type": "application/json" },
    body: JSON.stringify({ email: "dave@test.dev" }),
  });
  expect(res.status).toBe(403);
});

test("preview returns masked info for valid token", async () => {
  if (!knownInserted) {
    await insertInvite(
      "inv-known",
      await hashToken(knownToken),
      "bob@test.dev",
      Date.now(),
      Date.now() + 48 * 3600_000,
    );
    knownInserted = true;
  }
  const res = await exports.default.fetch(
    `http://localhost/teams/invites/preview?token=${encodeURIComponent(knownToken)}`,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    teamId: string;
    teamName: string;
    email: string;
    expiresAt: number;
  };
  expect(body.teamId).toBe(teamId);
  expect(body.teamName).toBe("Inv");
  expect(body.email).toBe("b***@test.dev");
  expect(body.expiresAt).toBeGreaterThan(Date.now());
});

test("preview with wrong token is 404", async () => {
  const res = await exports.default.fetch(
    "http://localhost/teams/invites/preview?token=wrong-token",
  );
  expect(res.status).toBe(404);
});

test("accept without session is 401", async () => {
  const res = await accept("", knownToken);
  expect(res.status).toBe(401);
});

test("bob accepts and becomes member", async () => {
  const bob = await signup("bob@test.dev");
  const res = await accept(bob, knownToken);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; teamId: string };
  expect(body.ok).toBe(true);
  expect(body.teamId).toBe(teamId);

  const list = await exports.default.fetch("http://localhost/teams", {
    headers: { cookie: bob },
  });
  const listBody = (await list.json()) as { teams: { id: string }[] };
  expect(listBody.teams.some((t) => t.id === teamId)).toBe(true);
});

test("reusing consumed token is 400", async () => {
  const bob = await signup("bob2@test.dev");
  const res = await accept(bob, knownToken);
  expect(res.status).toBe(400);
});

test("email mismatch is 403", async () => {
  const dave = await signup("dave@test.dev");
  const mismatchToken = "mismatch-token";
  await insertInvite(
    "inv-mismatch",
    await hashToken(mismatchToken),
    "bob@test.dev",
    Date.now(),
    Date.now() + 48 * 3600_000,
  );
  const res = await accept(dave, mismatchToken);
  expect(res.status).toBe(403);
});

test("expired invite cannot be accepted", async () => {
  const bob = await signup("bob3@test.dev");
  const expiredToken = "expired-token";
  await insertInvite(
    "inv-expired",
    await hashToken(expiredToken),
    "bob3@test.dev",
    Date.now() - 49 * 3600_000,
    Date.now() - 1000,
  );
  const res = await accept(bob, expiredToken);
  expect(res.status).toBe(400);
});

test("revoked invite cannot be accepted", async () => {
  const bob = await signup("bob4@test.dev");
  const revokeToken = "revoke-token";
  await insertInvite(
    "inv-revoke",
    await hashToken(revokeToken),
    "bob4@test.dev",
    Date.now(),
    Date.now() + 48 * 3600_000,
  );
  const revoke = await exports.default.fetch(
    `http://localhost/teams/${teamId}/invites/inv-revoke/revoke`,
    {
      method: "POST",
      headers: { cookie: aliceCookie },
    },
  );
  expect(revoke.status).toBe(200);
  const res = await accept(bob, revokeToken);
  expect(res.status).toBe(400);
});

test("already member accept returns ok without consuming", async () => {
  const bob = await signup("bob5@test.dev");
  const memberToken = "member-token";
  await insertInvite(
    "inv-member",
    await hashToken(memberToken),
    "bob5@test.dev",
    Date.now(),
    Date.now() + 48 * 3600_000,
  );
  const me = await exports.default.fetch("http://localhost/me", {
    headers: { cookie: bob },
  });
  const { user } = (await me.json()) as { user: { id: string } };
  await env.DB.prepare(
    "INSERT INTO team_members (team_id, user_id, roles, joined_at) VALUES (?, ?, 'team_user', ?)",
  )
    .bind(teamId, user.id, Date.now())
    .run();

  const res = await accept(bob, memberToken);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; teamId: string };
  expect(body.ok).toBe(true);

  const preview = await exports.default.fetch(
    `http://localhost/teams/invites/preview?token=${encodeURIComponent(memberToken)}`,
  );
  expect(preview.status).toBe(200);
});
