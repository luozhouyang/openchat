import { expect, test, vi } from "vite-plus/test";
import { createAuthService } from "../../src/services/auth.ts";

function makeSvc() {
  const setSessionToken = vi.fn(async () => {});
  const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify({ token: "sess-1" }), { status: 200 }),
  );
  globalThis.fetch = fetchMock as typeof globalThis.fetch;
  const svc = createAuthService({
    apiBaseUrl: "",
    getSessionToken: async () => null,
    setSessionToken,
  });
  return { svc, fetchMock };
}

test("signUp posts the name to /sign-up/email", async () => {
  const { svc, fetchMock } = makeSvc();
  await svc.signUp("alice@test.dev", "alice-password", "Alice");
  const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(String(input)).toContain("/api/auth/sign-up/email");
  const body = JSON.parse(String(init.body)) as { name: string; email: string };
  expect(body.name).toBe("Alice");
  expect(body.email).toBe("alice@test.dev");
});

test("sendVerificationEmail posts email and callbackURL", async () => {
  const { svc, fetchMock } = makeSvc();
  await svc.sendVerificationEmail("alice@test.dev", "/verify-email");
  const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(String(input)).toContain("/api/auth/send-verification-email");
  const body = JSON.parse(String(init.body)) as { email: string; callbackURL: string };
  expect(body.email).toBe("alice@test.dev");
  expect(body.callbackURL).toBe("/verify-email");
});

test("verifyEmail GETs /verify-email with the token", async () => {
  const { svc, fetchMock } = makeSvc();
  await svc.verifyEmail({ token: "tok-1", callbackURL: "/verify-email" });
  const [input] = fetchMock.mock.calls[0] as [string];
  expect(String(input)).toContain("/api/auth/verify-email");
  expect(String(input)).toContain("token=tok-1");
});
