import { expect, test } from "vite-plus/test";
import { exports } from "cloudflare:workers";

test("signup and get-session roundtrip", async () => {
  const signup = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "p0@test.dev",
      password: "p0-test-password",
      name: "P0 Tester",
    }),
  });
  expect(signup.status).toBe(200);
  const cookie = signup.headers.get("set-cookie");
  expect(cookie).toBeTruthy();

  const session = await exports.default.fetch("http://localhost/api/auth/get-session", {
    headers: { cookie: cookie! },
  });
  expect(session.status).toBe(200);
  const body = (await session.json()) as { user?: { email: string } };
  expect(body.user?.email).toBe("p0@test.dev");
});
