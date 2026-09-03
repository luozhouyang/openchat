import { expect, test, beforeAll } from "vite-plus/test";
import { exports } from "cloudflare:workers";

let sessionCookie = "";

beforeAll(async () => {
  const signup = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "jwt@test.dev",
      password: "jwt-test-password",
      name: "JWT",
    }),
  });
  sessionCookie = signup.headers.get("set-cookie") ?? "";
});

test("jwks endpoint serves keys", async () => {
  const res = await exports.default.fetch("http://localhost/api/auth/jwks");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { keys: unknown[] };
  expect(body.keys.length).toBeGreaterThan(0);
});

test("token endpoint issues verifiable jwt", async () => {
  const res = await exports.default.fetch("http://localhost/api/auth/token", {
    headers: { cookie: sessionCookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  expect(body.token.split(".")).toHaveLength(3);
});
