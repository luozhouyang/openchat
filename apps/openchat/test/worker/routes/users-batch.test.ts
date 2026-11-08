import { exports } from "cloudflare:workers";
import { beforeAll, expect, test } from "vite-plus/test";
import { signup, userIdOf } from "../helpers/setup.ts";

let aliceCookie = "";
let aliceId = "";
let bobId = "";

beforeAll(async () => {
  aliceCookie = await signup(exports.default, "ub-alice@test.dev", "test-password", "Alice");
  aliceId = await userIdOf(exports.default, aliceCookie);
  const bobCookie = await signup(exports.default, "ub-bob@test.dev", "test-password", "Bob");
  bobId = await userIdOf(exports.default, bobCookie);
});

async function listUsers(
  cookie: string,
  ids: string,
): Promise<{ status: number; body: { users: Array<Record<string, unknown>> } }> {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/users?ids=${encodeURIComponent(ids)}`,
    { headers: { cookie } },
  );
  return {
    status: res.status,
    body: (await res.json()) as { users: Array<Record<string, unknown>> },
  };
}

test("returns profiles for the requested ids", async () => {
  const { status, body } = await listUsers(aliceCookie, `${aliceId},${bobId}`);
  expect(status).toBe(200);
  expect(body.users.map((u) => u.id).sort()).toEqual([aliceId, bobId].sort());
});

test("never exposes email addresses", async () => {
  const { body } = await listUsers(aliceCookie, `${aliceId},${bobId}`);
  for (const user of body.users) {
    expect("email" in user).toBe(false);
  }
});

test("omits unknown ids instead of failing", async () => {
  const { status, body } = await listUsers(aliceCookie, `${aliceId},usr_missing`);
  expect(status).toBe(200);
  expect(body.users.map((u) => u.id)).toEqual([aliceId]);
});

test("deduplicates repeated ids", async () => {
  const { body } = await listUsers(aliceCookie, `${bobId},${bobId}`);
  expect(body.users).toHaveLength(1);
});

test("rejects unauthenticated calls", async () => {
  const res = await exports.default.fetch(`http://localhost/api/v1/users?ids=${bobId}`);
  expect(res.status).toBe(401);
});
