import { expect, test } from "vite-plus/test";
import { exports } from "cloudflare:workers";

async function signupRequest(body: Record<string, unknown>) {
  return exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("signup and get-session roundtrip", async () => {
  const res = await signupRequest({
    email: "p0@test.dev",
    password: "p0-test-password",
    name: "P0 Tester",
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie");
  expect(cookie).toBeTruthy();

  const session = await exports.default.fetch("http://localhost/api/auth/get-session", {
    headers: { cookie: cookie! },
  });
  expect(session.status).toBe(200);
  const body = (await session.json()) as { user?: { email: string } };
  expect(body.user?.email).toBe("p0@test.dev");
});

test("signup with username returns it on the user", async () => {
  const res = await signupRequest({
    email: "p1@test.dev",
    password: "p1-test-password",
    name: "P1 Tester",
    username: "p1tester",
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user?: { username?: string } };
  expect(body.user?.username).toBe("p1tester");

  const cookie = res.headers.get("set-cookie");
  const session = await exports.default.fetch("http://localhost/api/auth/get-session", {
    headers: { cookie: cookie! },
  });
  const sessionBody = (await session.json()) as { user?: { username?: string } };
  expect(sessionBody.user?.username).toBe("p1tester");
});

test("duplicate username signup rejected", async () => {
  const first = await signupRequest({
    email: "p2@test.dev",
    password: "p2-test-password",
    name: "P2 Tester",
    username: "dupuser",
  });
  expect(first.status).toBe(200);

  const dup = await signupRequest({
    email: "p3@test.dev",
    password: "p3-test-password",
    name: "P3 Tester",
    username: "dupuser",
  });
  expect(dup.status).toBe(422);
});
