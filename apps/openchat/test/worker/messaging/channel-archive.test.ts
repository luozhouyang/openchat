import { exports } from "cloudflare:workers";
import { beforeAll, expect, test } from "vite-plus/test";
import { signup } from "../helpers/setup.ts";

let cookie = "";
let channelId = "";

beforeAll(async () => {
  cookie = await signup(exports.default, "archive@test.dev", "test-password", "Archive");
  const teamRes = await exports.default.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "archive", displayName: "Archive", type: "open" }),
  });
  const teamId = ((await teamRes.json()) as { id: string }).id;
  const channelRes = await exports.default.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ teamId, name: "archive", displayName: "Archive", type: "public" }),
  });
  channelId = ((await channelRes.json()) as { id: string }).id;
});

async function detail(): Promise<{ archivedAt: number | null }> {
  const res = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}`, {
    headers: { cookie },
  });
  const body = (await res.json()) as { channel: { archivedAt: number | null } };
  return body.channel;
}

test("archives and restores a channel through the user-facing routes", async () => {
  const archive = await exports.default.fetch(`http://localhost/api/v1/channels/${channelId}`, {
    method: "DELETE",
    headers: { cookie },
  });
  expect(archive.status).toBe(200);
  expect((await detail()).archivedAt).not.toBeNull();

  const restore = await exports.default.fetch(
    `http://localhost/api/v1/channels/${channelId}/restore`,
    { method: "POST", headers: { cookie } },
  );
  expect(restore.status).toBe(200);
  expect((await detail()).archivedAt).toBeNull();
});
