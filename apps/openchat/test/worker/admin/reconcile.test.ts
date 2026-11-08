import { env, exports } from "cloudflare:workers";
import { beforeAll, expect, test } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { channelDoName } from "protocol";
import { getDb } from "@worker/db/client";
import { users } from "@worker/db/schema-d1";
import { signup, userIdOf } from "../helpers/setup.ts";

let adminCookie = "";
let channelId = "";
let bobId = "";

async function promoteAdmin(cookie: string): Promise<void> {
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie },
  });
  const userId = ((await me.json()) as { user: { id: string } }).user.id;
  await getDb(env.DB).update(users).set({ role: "admin" }).where(eq(users.id, userId));
}

beforeAll(async () => {
  adminCookie = await signup(exports.default, "reconcile-admin@test.dev", "test-password", "Admin");
  await promoteAdmin(adminCookie);
  const teamRes = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "reconcile", displayName: "Reconcile", type: "open" }),
  });
  const teamId = ((await teamRes.json()) as { id: string }).id;
  const channelRes = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name: "reconcile", displayName: "Reconcile", type: "public" }),
  });
  channelId = ((await channelRes.json()) as { id: string }).id;

  const bobCookie = await signup(exports.default, "reconcile-bob@test.dev", "test-password", "Bob");
  bobId = await userIdOf(exports.default, bobCookie);
  await exports.default.fetch(`http://localhost/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: { cookie: bobCookie, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/members`, {
    method: "POST",
    headers: { cookie: bobCookie },
  });

  const stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
  await stub.membersAdd({ userId: "usr_ghost", role: "member" });
});

function channelStub() {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
}

async function reconcile(cookie: string) {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/admin/channels/${channelId}/reconcile`,
    { method: "POST", headers: { cookie } },
  );
  return {
    status: res.status,
    body: (await res.json()) as { added: number; removed: number },
  };
}

test("removes DO members that no longer exist in D1", async () => {
  expect(await channelStub().memberIds()).toContain("usr_ghost");

  const result = await reconcile(adminCookie);
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ channelId, added: 0, removed: 1 });
  expect(await channelStub().memberIds()).not.toContain("usr_ghost");
});

test("restores DO members that still exist in D1", async () => {
  // Simulate a lost DO write: the D1 membership remains, the DO copy is gone.
  await channelStub().removeMember(bobId);
  expect(await channelStub().memberIds()).not.toContain(bobId);

  const result = await reconcile(adminCookie);
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ channelId, added: 1, removed: 0 });
  expect(await channelStub().memberIds()).toContain(bobId);
});

test("non-admins cannot trigger reconciliation", async () => {
  const outsider = await signup(
    exports.default,
    "reconcile-outsider@test.dev",
    "test-password",
    "Outsider",
  );
  const result = await reconcile(outsider);
  expect(result.status).toBe(403);
});
