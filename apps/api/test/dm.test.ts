import { expect, test, beforeAll } from "vite-plus/test";
import { exports } from "cloudflare:workers";

let a = "";
let b = "";
let aId = "";
let bId = "";

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "dm-test-password", name: email.split("@")[0] }),
  });
  return res.headers.get("set-cookie") ?? "";
}

async function userIdOf(cookie: string): Promise<string> {
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie },
  });
  return ((await me.json()) as { user: { id: string } }).user.id;
}

beforeAll(async () => {
  a = await signup("dm-a@test.dev");
  b = await signup("dm-b@test.dev");
  aId = await userIdOf(a);
  bId = await userIdOf(b);
});

test("dm is idempotent", async () => {
  const first = await exports.default.fetch("http://localhost/api/v1/channels/direct", {
    method: "POST",
    headers: { cookie: a, "content-type": "application/json" },
    body: JSON.stringify({ userIds: [aId, bId] }),
  });
  expect(first.status).toBe(201);
  const firstBody = (await first.json()) as { id: string };

  const second = await exports.default.fetch("http://localhost/api/v1/channels/direct", {
    method: "POST",
    headers: { cookie: a, "content-type": "application/json" },
    body: JSON.stringify({ userIds: [bId, aId] }),
  });
  expect(second.status).toBe(200);
  const secondBody = (await second.json()) as { id: string; existing: boolean };
  expect(secondBody.id).toBe(firstBody.id);
  expect(secondBody.existing).toBe(true);
});

test("gm is idempotent and order-insensitive", async () => {
  const c = await signup("dm-c@test.dev");
  const d = await signup("dm-d@test.dev");
  const cId = await userIdOf(c);
  const dId = await userIdOf(d);

  const first = await exports.default.fetch("http://localhost/api/v1/channels/group", {
    method: "POST",
    headers: { cookie: a, "content-type": "application/json" },
    body: JSON.stringify({ userIds: [aId, bId, cId, dId] }),
  });
  expect(first.status).toBe(201);
  const firstBody = (await first.json()) as { id: string };

  const second = await exports.default.fetch("http://localhost/api/v1/channels/group", {
    method: "POST",
    headers: { cookie: a, "content-type": "application/json" },
    body: JSON.stringify({ userIds: [dId, cId, bId, aId] }),
  });
  expect(second.status).toBe(200);
  const secondBody = (await second.json()) as { id: string; existing: boolean };
  expect(secondBody.id).toBe(firstBody.id);
  expect(secondBody.existing).toBe(true);
});
