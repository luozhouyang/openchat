import { exports } from "cloudflare:workers";
import { beforeAll, expect, test } from "vite-plus/test";
import { signup } from "../helpers/setup.ts";

// better-auth 1.7.2 serves the reset request at /request-password-reset; the
// older /forget-password path is no longer registered by the core package.
const REQUEST_RESET_PATH = "/api/auth/request-password-reset";

const KNOWN_EMAIL = "reset-known@test.dev";
const OLD_PASSWORD = "old-password";

async function postJson(path: string, body: unknown): Promise<Response> {
  return exports.default.fetch(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const cookie = await signup(exports.default, KNOWN_EMAIL, OLD_PASSWORD, "Reset");
  expect(cookie).toBeTruthy();
});

test("reset request for a known account returns 200", async () => {
  const res = await postJson(REQUEST_RESET_PATH, {
    email: KNOWN_EMAIL,
    redirectTo: "/auth/reset-password",
  });
  expect(res.status).toBe(200);
});

test("reset request for an unknown account also returns 200 (no enumeration)", async () => {
  const res = await postJson(REQUEST_RESET_PATH, {
    email: "reset-unknown@test.dev",
    redirectTo: "/auth/reset-password",
  });
  expect(res.status).toBe(200);
});

test("invalid reset token is rejected and the old password still works", async () => {
  const reset = await postJson("/api/auth/reset-password", {
    newPassword: "brand-new-password",
    token: "invalid-token",
  });
  expect(reset.status).toBe(400);

  const login = await postJson("/api/auth/sign-in/email", {
    email: KNOWN_EMAIL,
    password: OLD_PASSWORD,
  });
  expect(login.status).toBe(200);
});
