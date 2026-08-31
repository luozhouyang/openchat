import { expect, test } from "vite-plus/test";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client.ts";
import { teams, teamMembers } from "../../src/db/schema-d1.ts";
import { createTeam, joinTeam, leaveTeam, updateTeam } from "../../src/services/team.service.ts";
import { HttpError } from "../../src/lib/errors.ts";

async function expectHttpError(p: Promise<unknown>, code: string, status: number) {
  try {
    await p;
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).code).toBe(code);
    expect((err as HttpError).status).toBe(status);
  }
}

test("createTeam writes team and admin member rows", async () => {
  const db = getDb(env.DB);
  const { id: teamId, inviteCode } = await createTeam(db, {
    name: "svc-team-1",
    displayName: "Svc Team",
    type: "open",
    creatorId: "user-svc-1",
  });
  expect(teamId).toMatch(/^team_/);
  expect(inviteCode).toBeUndefined();

  const teamRows = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  expect(teamRows).toHaveLength(1);
  expect(teamRows[0].creatorId).toBe("user-svc-1");

  const memberRows = await db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
  expect(memberRows).toHaveLength(1);
  expect(memberRows[0].userId).toBe("user-svc-1");
  expect(memberRows[0].roles).toBe("team_admin");
});

test("invite team generates invite code", async () => {
  const db = getDb(env.DB);
  const { id: teamId, inviteCode } = await createTeam(db, {
    name: "svc-team-inv",
    displayName: "Invite Only",
    type: "invite",
    creatorId: "user-svc-inv",
  });
  expect(inviteCode).toBeTruthy();
  const row = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  expect(row[0].inviteCode).toBe(inviteCode);
});

test("createTeam duplicate name throws HttpError 409", async () => {
  const db = getDb(env.DB);
  await createTeam(db, {
    name: "svc-team-dup",
    displayName: "Dup",
    type: "open",
    creatorId: "user-svc-2",
  });
  await expectHttpError(
    createTeam(db, {
      name: "svc-team-dup",
      displayName: "Dup 2",
      type: "open",
      creatorId: "user-svc-3",
    }),
    "name_taken",
    409,
  );
});

test("joinTeam adds member to open team", async () => {
  const db = getDb(env.DB);
  const { id: teamId } = await createTeam(db, {
    name: "svc-team-join",
    displayName: "Join",
    type: "open",
    creatorId: "user-svc-owner",
  });
  await joinTeam(db, { teamId, userId: "user-svc-joiner" });

  const rows = await db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.roles)).toContain("team_user");
});

test("joinTeam is idempotent for existing member", async () => {
  const db = getDb(env.DB);
  const { id: teamId } = await createTeam(db, {
    name: "svc-team-join2",
    displayName: "Join 2",
    type: "open",
    creatorId: "user-svc-owner2",
  });
  await joinTeam(db, { teamId, userId: "user-svc-joiner2" });
  await joinTeam(db, { teamId, userId: "user-svc-joiner2" });

  const rows = await db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
  expect(rows).toHaveLength(2);
});

test("joinTeam invite team requires matching code", async () => {
  const db = getDb(env.DB);
  const { id: teamId, inviteCode } = await createTeam(db, {
    name: "svc-team-invite-join",
    displayName: "Invite Join",
    type: "invite",
    creatorId: "user-svc-owner3",
  });
  await expectHttpError(joinTeam(db, { teamId, userId: "user-svc-joiner3" }), "forbidden", 403);
  await joinTeam(db, { teamId, userId: "user-svc-joiner3", inviteCode });
  await expectHttpError(
    joinTeam(db, { teamId, userId: "user-svc-joiner4", inviteCode: "bogus" }),
    "forbidden",
    403,
  );
});

test("joinTeam missing team throws 404", async () => {
  const db = getDb(env.DB);
  await expectHttpError(
    joinTeam(db, { teamId: "team_nope", userId: "user-svc-x" }),
    "not found",
    404,
  );
});

test("leaveTeam sole admin throws 409", async () => {
  const db = getDb(env.DB);
  const { id: teamId } = await createTeam(db, {
    name: "svc-team-leave",
    displayName: "Leave",
    type: "open",
    creatorId: "user-svc-leave",
  });
  await expectHttpError(
    leaveTeam(db, { teamId, userId: "user-svc-leave" }),
    "transfer_admin_first",
    409,
  );
});

test("leaveTeam non-admin member leaves", async () => {
  const db = getDb(env.DB);
  const { id: teamId } = await createTeam(db, {
    name: "svc-team-leave2",
    displayName: "Leave 2",
    type: "open",
    creatorId: "user-svc-owner4",
  });
  await joinTeam(db, { teamId, userId: "user-svc-leaver" });
  await leaveTeam(db, { teamId, userId: "user-svc-leaver" });

  const rows = await db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
  expect(rows).toHaveLength(1);
});

test("leaveTeam no-op when not a member", async () => {
  const db = getDb(env.DB);
  const { id: teamId } = await createTeam(db, {
    name: "svc-team-leave3",
    displayName: "Leave 3",
    type: "open",
    creatorId: "user-svc-owner5",
  });
  await expect(leaveTeam(db, { teamId, userId: "user-svc-ghost" })).resolves.toBeUndefined();
});

test("updateTeam archives and renames", async () => {
  const db = getDb(env.DB);
  const { id: teamId } = await createTeam(db, {
    name: "svc-team-update",
    displayName: "Update",
    type: "open",
    creatorId: "user-svc-owner6",
  });
  await updateTeam(db, { teamId, patch: { displayName: "Updated", archived: true } });

  const row = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  expect(row[0].displayName).toBe("Updated");
  expect(row[0].archivedAt).toBeTruthy();

  await updateTeam(db, { teamId, patch: { archived: false } });
  const row2 = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  expect(row2[0].archivedAt).toBeNull();
});
