import { env } from "cloudflare:workers";
import { exports } from "cloudflare:workers";
import { expect, test, beforeAll } from "vite-plus/test";
import { signup, userIdOf } from "../helpers/setup.ts";

let aliceCookie = "";
let aliceId = "";
let bobCookie = "";
let bobId = "";
let carolId = "";

beforeAll(async () => {
  aliceCookie = await signup(exports.default, "ua-alice@test.dev", "test-password", "Alice");
  aliceId = await userIdOf(exports.default, aliceCookie);
  bobCookie = await signup(exports.default, "ua-bob@test.dev", "test-password", "Bob");
  bobId = await userIdOf(exports.default, bobCookie);
  const carolCookie = await signup(exports.default, "ua-carol@test.dev", "test-password", "Carol");
  carolId = await userIdOf(exports.default, carolCookie);
  await env.DB.prepare("UPDATE users SET nickname = ? WHERE id = ?").bind("Carolyn", carolId).run();
});

async function search(cookie: string, term: string): Promise<{ status: number; body: any }> {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/users/autocomplete?term=${encodeURIComponent(term)}`,
    { headers: { cookie } },
  );
  return { status: res.status, body: await res.json() };
}

test("returns users whose username/nickname match, ordered, without email", async () => {
  const { status, body } = await search(aliceCookie, "carol");
  expect(status).toBe(200);
  const item = body.users.find((u: { id: string }) => u.id === carolId);
  expect(item).toBeTruthy();
  expect(item.nickname).toBe("Carolyn");
  expect("email" in item).toBe(false);
});

test("excludes the caller from results", async () => {
  const { body } = await search(aliceCookie, "ua-"); // matches every signed-up test user
  expect(body.users.some((u: { id: string }) => u.id === aliceId)).toBe(false);
  expect(body.users.some((u: { id: string }) => u.id === bobId)).toBe(true);
});

test("limit caps the number of results", async () => {
  const res = await exports.default.fetch(
    "http://localhost/api/v1/users/autocomplete?term=ua-&limit=1",
    { headers: { cookie: aliceCookie } },
  );
  const body = (await res.json()) as { users: { id: string }[] };
  expect(body.users.length).toBeLessThanOrEqual(1);
});

test("blank term returns an empty list", async () => {
  const { status, body } = await search(aliceCookie, "   ");
  expect(status).toBe(200);
  expect(body.users).toEqual([]);
});

test("requires a session", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/users/autocomplete?term=a");
  expect(res.status).toBe(401);
});
