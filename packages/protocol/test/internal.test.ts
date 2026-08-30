import { expect, test } from "vite-plus/test";
import { issueInternalToken, verifyInternalToken } from "../src/index.ts";

const secret = "test-secret-key-0123456789";

test("issue + verify roundtrip", async () => {
  const token = await issueInternalToken({ subject: "user:u1", secret });
  const payload = await verifyInternalToken(token, secret);
  expect(payload?.subject).toBe("user:u1");
});

test("reject wrong secret", async () => {
  const token = await issueInternalToken({ subject: "user:u1", secret });
  expect(await verifyInternalToken(token, "other-secret-0123456789")).toBeNull();
});

test("reject expired token", async () => {
  const token = await issueInternalToken({ subject: "user:u1", secret, ttlSeconds: -1 });
  expect(await verifyInternalToken(token, secret)).toBeNull();
});

test("reject tampered token", async () => {
  const token = await issueInternalToken({ subject: "user:u1", secret });
  const tampered = token.slice(0, -2) + "xx";
  expect(await verifyInternalToken(tampered, secret)).toBeNull();
});
