import { expect, test, beforeAll } from "vite-plus/test";
import { exports } from "cloudflare:workers";

let sessionCookie = "";

beforeAll(async () => {
  const signup = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "ws@test.dev",
      password: "ws-test-password",
      name: "WS",
    }),
  });
  sessionCookie = signup.headers.get("set-cookie") ?? "";
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
    headers: { cookie: sessionCookie },
  });
  const { token } = (await tokenRes.json()) as { token: string };
  const res = await exports.default.fetch("http://localhost/ws?deviceId=d1", {
    headers: { Upgrade: "websocket", authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(101);
});
