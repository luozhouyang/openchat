import { exports } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";

test("echoes a caller-supplied request id", async () => {
  const res = await exports.default.fetch("http://localhost/health", {
    headers: { "x-request-id": "test-request-id" },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("x-request-id")).toBe("test-request-id");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("x-frame-options")).toBe("DENY");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
});

test("generates a request id and returns it with errors", async () => {
  const res = await exports.default.fetch("http://localhost/api/v1/users/me");
  expect(res.status).toBe(401);
  const requestId = res.headers.get("x-request-id");
  expect(requestId).toBeTruthy();
  const body = (await res.json()) as { error: string; requestId: string };
  expect(body.error).toBeTruthy();
  expect(body.requestId).toBe(requestId);
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
});
