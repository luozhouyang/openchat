import { exports } from "cloudflare:workers";
import { expect, test, beforeAll } from "vite-plus/test";
import { signup, userIdOf } from "../helpers/setup.ts";

let aliceCookie = "";
let bobCookie = "";
let aliceId = "";
let bobId = "";

beforeAll(async () => {
  aliceCookie = await signup(exports.default, "st-alice@test.dev", "st-test-password", "Alice");
  bobCookie = await signup(exports.default, "st-bob@test.dev", "st-test-password", "Bob");
  aliceId = await userIdOf(exports.default, aliceCookie);
  bobId = await userIdOf(exports.default, bobCookie);
});

test("GET /users/me/status returns offline by default", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me/status", {
    headers: { cookie: aliceCookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ userId: aliceId, status: "offline", manual: false });
  expect(body).toHaveProperty("lastActivityAt");
  expect(body).toHaveProperty("dndEndTime");
});

test("PUT /users/me/status then GET returns it", async () => {
  const dndEnd = Date.now() + 3600_000;
  const put = await exports.default.fetch("http://localhost/api/v1/users/me/status", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: aliceCookie },
    body: JSON.stringify({ status: "dnd", dndEndTime: dndEnd }),
  });
  expect(put.status).toBe(200);
  expect(await put.json()).toEqual({ ok: true });

  const res = await exports.default.fetch("http://localhost/api/v1/users/me/status", {
    headers: { cookie: aliceCookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ userId: aliceId, status: "dnd", manual: true });
  expect(body.dndEndTime).toBe(dndEnd);
});

test("PUT status for another user returns 403", async () => {
  const put = await exports.default.fetch(`http://localhost/api/v1/users/${bobId}/status`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: aliceCookie },
    body: JSON.stringify({ status: "away" }),
  });
  expect(put.status).toBe(403);
});

test("invalid status value returns 422", async () => {
  const put = await exports.default.fetch("http://localhost/api/v1/users/me/status", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: aliceCookie },
    body: JSON.stringify({ status: "zzz" }),
  });
  expect(put.status).toBe(422);
});

test("POST /users/status/ids returns presence statuses", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/users/status/ids", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: aliceCookie },
    body: JSON.stringify({ userIds: [aliceId, bobId, "status-nonexistent"] }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { statuses: Record<string, string> };
  expect(Object.keys(body.statuses)).toEqual([aliceId, bobId, "status-nonexistent"]);
  for (const status of Object.values(body.statuses)) {
    expect(["online", "away", "offline"]).toContain(status);
  }
});

test("POST /users/status/ids rejects more than 200 ids", async () => {
  const userIds = Array.from({ length: 201 }, (_, i) => `status-user-${i}`);
  const res = await exports.default.fetch("http://localhost/api/v1/users/status/ids", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: aliceCookie },
    body: JSON.stringify({ userIds }),
  });
  expect(res.status).toBe(422);
});

test("status endpoints require session", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me/status");
  expect(res.status).toBe(401);
});
