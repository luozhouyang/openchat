import { expect, test, beforeAll } from "vite-plus/test";
import { exports } from "cloudflare:workers";

async function signup(
  email: string,
  password: string,
  name: string,
  extra: Record<string, unknown> = {},
) {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name, ...extra }),
  });
  return { res, cookie: res.headers.get("set-cookie") ?? "" };
}

test("signup and get-session roundtrip", async () => {
  const { res, cookie } = await signup("p0@test.dev", "p0-test-password", "P0 Tester");
  expect(res.status).toBe(200);
  expect(cookie).toBeTruthy();

  const session = await exports.default.fetch("http://localhost/api/auth/get-session", {
    headers: { cookie },
  });
  expect(session.status).toBe(200);
  const body = (await session.json()) as { user?: { email: string } };
  expect(body.user?.email).toBe("p0@test.dev");
});

test("signup with username returns it on the user", async () => {
  const { res, cookie } = await signup("p1@test.dev", "p1-test-password", "P1 Tester", {
    username: "p1tester",
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user?: { username?: string } };
  expect(body.user?.username).toBe("p1tester");

  const session = await exports.default.fetch("http://localhost/api/auth/get-session", {
    headers: { cookie },
  });
  const sessionBody = (await session.json()) as { user?: { username?: string } };
  expect(sessionBody.user?.username).toBe("p1tester");
});

test("duplicate username signup rejected", async () => {
  const first = await signup("p2@test.dev", "p2-test-password", "P2 Tester", {
    username: "dupuser",
  });
  expect(first.res.status).toBe(200);

  const dup = await signup("p3@test.dev", "p3-test-password", "P3 Tester", { username: "dupuser" });
  expect(dup.res.status).toBe(422);
});

let sessionCookie = "";

beforeAll(async () => {
  sessionCookie = (await signup("me@test.dev", "me-test-password", "Me")).cookie;
});

test("GET /me without session returns 401", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me");
  expect(res.status).toBe(401);
});

test("GET /me with cookie returns user", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me", {
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
  const res = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user: { email: string } };
  expect(body.user.email).toBe("me@test.dev");
});

let jwksCookie = "";

beforeAll(async () => {
  jwksCookie = (await signup("jwt@test.dev", "jwt-test-password", "JWT")).cookie;
});

test("jwks endpoint serves keys", async () => {
  const res = await exports.default.fetch("http://localhost/api/auth/jwks");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { keys: unknown[] };
  expect(body.keys.length).toBeGreaterThan(0);
});

test("token endpoint issues verifiable jwt", async () => {
  const res = await exports.default.fetch("http://localhost/api/auth/token", {
    headers: { cookie: jwksCookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  expect(body.token.split(".")).toHaveLength(3);
});

let wsCookie = "";

beforeAll(async () => {
  wsCookie = (await signup("ws@test.dev", "ws-test-password", "WS")).cookie;
});

test("upgrade without token returns 401", async () => {
  const res = await exports.default.fetch("http://localhost/ws?deviceId=d1", {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(401);
});

test("upgrade with garbage token returns 401", async () => {
  const res = await exports.default.fetch("http://localhost/ws?deviceId=d1", {
    headers: { Upgrade: "websocket", authorization: "Bearer garbage" },
  });
  expect(res.status).toBe(401);
});

test("upgrade with valid jwt succeeds", async () => {
  const tokenRes = await exports.default.fetch("http://localhost/api/auth/token", {
    headers: { cookie: wsCookie },
  });
  const { token } = (await tokenRes.json()) as { token: string };
  const res = await exports.default.fetch("http://localhost/ws?deviceId=d1", {
    headers: { Upgrade: "websocket", authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(101);
});
