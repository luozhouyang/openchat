import { expect, test, beforeAll } from "vite-plus/test";
import { exports } from "cloudflare:workers";
import { signup, userIdOf } from "../helpers/setup.ts";

let aliceCookie = "";
let bobCookie = "";
let aliceId = "";
let bobId = "";

beforeAll(async () => {
  aliceCookie = await signup(exports.default, "pref-alice@test.dev", "pref-test-password", "Alice");
  bobCookie = await signup(exports.default, "pref-bob@test.dev", "pref-test-password", "Bob");
  aliceId = await userIdOf(exports.default, aliceCookie);
  bobId = await userIdOf(exports.default, bobCookie);
});

test("PUT /users/me/preferences stores prefs and GET returns them", async () => {
  const put = await exports.default.fetch("http://localhost/api/v1/users/me/preferences", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: aliceCookie },
    body: JSON.stringify([
      { category: "theme", name: "mode", value: "dark" },
      { category: "notify", name: "mentions", value: "1" },
      { category: "theme", name: "accent", value: "blue" },
    ]),
  });
  expect(put.status).toBe(200);
  expect(await put.json()).toEqual({ ok: true });

  const res = await exports.default.fetch("http://localhost/api/v1/users/me/preferences", {
    headers: { cookie: aliceCookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    preferences: { category: string; name: string; value: string }[];
  };
  expect(body.preferences).toEqual(
    expect.arrayContaining([
      { category: "theme", name: "mode", value: "dark" },
      { category: "notify", name: "mentions", value: "1" },
      { category: "theme", name: "accent", value: "blue" },
    ]),
  );
});

test("GET /users/:user_id/preferences/:category filters by category", async () => {
  const res = await exports.default.fetch(
    `http://localhost/api/v1/users/${aliceId}/preferences/theme`,
    { headers: { cookie: aliceCookie } },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { preferences: { category: string; name: string }[] };
  expect(body.preferences).toEqual(
    expect.arrayContaining([
      { category: "theme", name: "mode", value: "dark" },
      { category: "theme", name: "accent", value: "blue" },
    ]),
  );
  expect(body.preferences.every((p) => p.category === "theme")).toBe(true);
});

test("GET /users/:user_id/preferences/:category/name/:preference_name returns value", async () => {
  const res = await exports.default.fetch(
    "http://localhost/api/v1/users/me/preferences/notify/name/mentions",
    { headers: { cookie: aliceCookie } },
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ value: "1" });
});

test("missing preference returns null value", async () => {
  const res = await exports.default.fetch(
    "http://localhost/api/v1/users/me/preferences/theme/name/missing",
    { headers: { cookie: aliceCookie } },
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ value: null });
});

test("DELETE /users/:user_id/preferences removes prefs", async () => {
  const del = await exports.default.fetch(`http://localhost/api/v1/users/${aliceId}/preferences`, {
    method: "DELETE",
    headers: { "content-type": "application/json", cookie: aliceCookie },
    body: JSON.stringify([{ category: "theme", name: "accent" }]),
  });
  expect(del.status).toBe(200);
  expect(await del.json()).toEqual({ ok: true });

  const res = await exports.default.fetch(
    "http://localhost/api/v1/users/me/preferences/theme/name/accent",
    { headers: { cookie: aliceCookie } },
  );
  expect(await res.json()).toEqual({ value: null });
});

test("reading another user's preferences returns 403", async () => {
  const res = await exports.default.fetch(`http://localhost/api/v1/users/${bobId}/preferences`, {
    headers: { cookie: aliceCookie },
  });
  expect(res.status).toBe(403);
});

test("writing another user's preferences returns 403", async () => {
  const res = await exports.default.fetch(`http://localhost/api/v1/users/${bobId}/preferences`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: aliceCookie },
    body: JSON.stringify([{ category: "theme", name: "mode", value: "light" }]),
  });
  expect(res.status).toBe(403);
});

test("preferences endpoints require session", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me/preferences");
  expect(res.status).toBe(401);
});
