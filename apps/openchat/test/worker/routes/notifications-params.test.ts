import { exports } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";
import { signup } from "../helpers/setup.ts";

test("marking many notifications read chunks ids beyond D1's bound-parameter limit", async () => {
  const cookie = await signup(
    exports.default,
    "notif-params@test.dev",
    "test-password",
    "Notif Params",
  );
  const ids = Array.from({ length: 150 }, (_, index) => `ntf_${index}`);

  const mark = await exports.default.fetch("http://localhost/api/v1/users/me/notifications/read", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ ids }),
  });
  expect(mark.status).toBe(200);

  const list = await exports.default.fetch("http://localhost/api/v1/users/me/notifications", {
    headers: { cookie },
  });
  expect(list.status).toBe(200);
  const body = (await list.json()) as { notifications: unknown[] };
  expect(body.notifications).toEqual([]);
});
