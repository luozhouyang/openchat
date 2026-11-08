import { exports } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";
import { signup } from "../helpers/setup.ts";

test("status lookup chunks ids beyond D1's bound-parameter limit", async () => {
  const cookie = await signup(
    exports.default,
    "status-params@test.dev",
    "test-password",
    "Status Params",
  );
  const userIds = Array.from({ length: 150 }, (_, index) => `usr_${index}`);

  const res = await exports.default.fetch("http://localhost/api/v1/users/status/ids", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ userIds }),
  });

  expect(res.status).toBe(200);
  const body = (await res.json()) as { statuses: Record<string, string> };
  expect(Object.keys(body.statuses)).toHaveLength(150);
  for (const status of Object.values(body.statuses)) {
    expect(status).toBe("offline");
  }
});
