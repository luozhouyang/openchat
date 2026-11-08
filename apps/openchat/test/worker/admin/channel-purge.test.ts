import { env, exports } from "cloudflare:workers";
import { beforeAll, expect, test } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { channelDoName } from "protocol";
import { getDb } from "@worker/db/client";
import { users } from "@worker/db/schema-d1";
import { signup } from "../helpers/setup.ts";

let cookie = "";
let channelId = "";

beforeAll(async () => {
  cookie = await signup(exports.default, "purge-admin@test.dev", "test-password", "Purge");
  const me = await exports.default.fetch("http://localhost/api/v1/users/me", {
    headers: { cookie },
  });
  const userId = ((await me.json()) as { user: { id: string } }).user.id;
  await getDb(env.DB).update(users).set({ role: "admin" }).where(eq(users.id, userId));

  const teamRes = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "purge", displayName: "Purge", type: "open" }),
  });
  const teamId = ((await teamRes.json()) as { id: string }).id;
  const channelRes = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name: "purge", displayName: "Purge", type: "public" }),
  });
  channelId = ((await channelRes.json()) as { id: string }).id;
  const postRes = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/posts`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ message: "to be purged", clientToken: crypto.randomUUID() }),
    },
  );
  expect(postRes.status).toBe(201);
});

test("deleting a channel drops its Durable Object storage", async () => {
  const stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
  expect((await stub.count()).count).toBe(1);

  const res = await exports.default.fetch(
    `http://localhost/api/v1/admin/channels/${channelId}/delete`,
    { method: "POST", headers: { cookie } },
  );
  expect(res.status).toBe(200);

  expect((await stub.count()).count).toBe(0);
  const detail = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}`, {
    headers: { cookie },
  });
  expect(detail.status).toBe(404);
});
