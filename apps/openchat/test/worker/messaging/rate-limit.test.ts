import { exports } from "cloudflare:workers";
import { beforeAll, expect, test } from "vite-plus/test";
import { signup } from "../helpers/setup.ts";

let cookie = "";
let channelId = "";

beforeAll(async () => {
  cookie = await signup(exports.default, "rate-limit@test.dev", "test-password", "Rate");
  const teamRes = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "rate-limit", displayName: "Rate Limit", type: "open" }),
  });
  const teamId = ((await teamRes.json()) as { id: string }).id;
  const channelRes = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name: "rate", displayName: "Rate", type: "public" }),
  });
  channelId = ((await channelRes.json()) as { id: string }).id;
});

test("the sixth message within a second is rate limited", async () => {
  const send = () =>
    exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/posts`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ message: "spam", clientToken: crypto.randomUUID() }),
    });

  const statuses: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    statuses.push((await send()).status);
  }

  expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
  expect(statuses[5]).toBe(429);
});
