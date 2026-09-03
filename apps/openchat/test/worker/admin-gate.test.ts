import { expect, test, beforeAll } from "vite-plus/test";
import { exports } from "cloudflare:workers";

let userCookie = "";

beforeAll(async () => {
  const signup = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "plain@test.dev",
      password: "admin-test-password",
      name: "Plain",
    }),
  });
  userCookie = signup.headers.get("set-cookie") ?? "";
});

test("admin endpoint rejects unauthenticated", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/admin/settings");
  expect(res.status).toBe(401);
});

test("admin endpoint rejects non-admin", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/admin/settings", {
    headers: { cookie: userCookie },
  });
  expect(res.status).toBe(403);
});

test("admin endpoint rejects bearer without session", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/admin/settings", {
    headers: { authorization: "Bearer invalid-token" },
  });
  expect(res.status).toBe(401);
});
