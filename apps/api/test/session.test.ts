import { expect, test, beforeAll } from "vite-plus/test";
import { exports } from "cloudflare:workers";

let sessionCookie = "";

beforeAll(async () => {
  const signup = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "me@test.dev", password: "me-test-password", name: "Me" }),
  });
  sessionCookie = signup.headers.get("set-cookie") ?? "";
});

test("GET /me without session returns 401", async () => {
  const res = await exports.default.fetch("http://localhost/me");
  expect(res.status).toBe(401);
});

test("GET /me with cookie returns user", async () => {
  const res = await exports.default.fetch("http://localhost/me", {
    headers: { cookie: sessionCookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user: { email: string } };
  expect(body.user.email).toBe("me@test.dev");
});

test("GET /me with bearer jwt returns user", async () => {
  const tokenRes = await exports.default.fetch("http://localhost/api/auth/token", {
    headers: { cookie: sessionCookie },
  });
  const { token } = (await tokenRes.json()) as { token: string };
  const res = await exports.default.fetch("http://localhost/me", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user: { email: string } };
  expect(body.user.email).toBe("me@test.dev");
});
