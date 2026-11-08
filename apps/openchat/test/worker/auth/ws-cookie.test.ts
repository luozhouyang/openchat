import { exports } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";
import { signup } from "../helpers/setup.ts";

test("websocket upgrade accepts a same-origin session cookie", async () => {
  const cookie = await signup(exports.default, "ws-cookie@test.dev", "test-password", "Cookie");
  const res = await exports.default.fetch("http://localhost/ws?deviceId=cookie-test", {
    headers: { Upgrade: "websocket", cookie },
  });
  expect(res.status).toBe(101);
});

test("websocket upgrade still rejects requests without token or cookie", async () => {
  const res = await exports.default.fetch("http://localhost/ws?deviceId=no-auth", {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(401);
});
