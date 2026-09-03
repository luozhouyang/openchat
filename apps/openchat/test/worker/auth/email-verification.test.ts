import { expect, test } from "vite-plus/test";
import { exports } from "cloudflare:workers";

async function signup(email: string, password: string, name: string) {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  return { res, cookie: res.headers.get("set-cookie") ?? "" };
}

test("signup with email verification enabled still returns a session", async () => {
  const { res, cookie } = await signup("ev0@test.dev", "ev0-test-password", "EV0");
  expect(res.status).toBe(200);
  expect(cookie).toBeTruthy();
  const session = await exports.default.fetch("http://localhost/api/auth/get-session", {
    headers: { cookie },
  });
  expect(session.status).toBe(200);
});

test("verify-email with an invalid token redirects with an error query", async () => {
  const res = await exports.default.fetch(
    "http://localhost/api/auth/verify-email?token=bogus&callbackURL=%2Fverify-email",
    { headers: { Origin: "http://localhost" }, redirect: "manual" },
  );
  expect(res.status).toBeGreaterThanOrEqual(300);
  expect(res.status).toBeLessThan(400);
  const location = res.headers.get("location");
  expect(location).toBeTruthy();
  expect(new URL(location!, "http://localhost").searchParams.get("error")).toBeTruthy();
});
