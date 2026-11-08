import { env, exports } from "cloudflare:workers";
import { beforeAll, expect, test } from "vite-plus/test";
import { channelDoName } from "protocol";
import { signup } from "../helpers/setup.ts";

let cookie = "";
let channelId = "";

async function post(message: string): Promise<void> {
  const res = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}/posts`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ message, clientToken: crypto.randomUUID() }),
  });
  expect(res.status).toBe(201);
}

beforeAll(async () => {
  cookie = await signup(exports.default, "retention@test.dev", "test-password", "Retention");
  const teamRes = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "retention", displayName: "Retention", type: "open" }),
  });
  const teamId = ((await teamRes.json()) as { id: string }).id;
  const channelRes = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name: "retention", displayName: "Retention", type: "public" }),
  });
  channelId = ((await channelRes.json()) as { id: string }).id;
});

test("purgeMessagesBefore removes aged messages and resets the sidebar meta", async () => {
  await post("one");
  await post("two");
  await post("three");

  const stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
  expect((await stub.count()).count).toBe(3);

  // A future cutoff purges everything; the retention alarm passes the real one.
  const result = await stub.purgeMessagesBefore(Date.now() + 60_000);
  expect(result.deleted).toBe(3);
  expect((await stub.count()).count).toBe(0);

  const meta = await stub.meta();
  expect(meta.last_message_id).toBeUndefined();
  expect(meta.last_message_preview).toBeUndefined();
});
