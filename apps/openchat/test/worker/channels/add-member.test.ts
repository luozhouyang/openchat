import { exports } from "cloudflare:workers";
import { beforeAll, expect, test } from "vite-plus/test";
import { signup, userIdOf } from "../helpers/setup.ts";

const worker = exports.default;

let admin = "";
let bob = "";
let carol = "";
let bobId = "";
let carolId = "";
let teamId = "";
let channelId = "";

function addMemberBy(cookie: string, userId: string): Promise<Response> {
  return worker.fetch(`http://localhost/api/v1/channels/${channelId}/members/${userId}`, {
    method: "POST",
    headers: { cookie },
  });
}

beforeAll(async () => {
  admin = await signup(worker, "add-member-admin@test.dev");
  bob = await signup(worker, "add-member-bob@test.dev");
  carol = await signup(worker, "add-member-carol@test.dev");
  bobId = await userIdOf(worker, bob);
  carolId = await userIdOf(worker, carol);

  const team = await worker.fetch("http://localhost/api/v1/teams", {
    method: "POST",
    headers: { cookie: admin, "content-type": "application/json" },
    body: JSON.stringify({ name: "add-member-team", displayName: "Add Member Team", type: "open" }),
  });
  expect(team.status).toBe(201);
  teamId = ((await team.json()) as { id: string }).id;

  // Bob joins the team only; carol never joins it.
  const join = await worker.fetch(`http://localhost/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: { cookie: bob, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(join.status).toBe(200);

  const create = await worker.fetch("http://localhost/api/v1/channels", {
    method: "POST",
    headers: { cookie: admin, "content-type": "application/json" },
    body: JSON.stringify({
      teamId,
      name: "add-member-channel",
      displayName: "Add Member Channel",
      type: "public",
    }),
  });
  expect(create.status).toBe(201);
  channelId = ((await create.json()) as { id: string }).id;
});

test("admin adds a team member to the channel", async () => {
  const res = await addMemberBy(admin, bobId);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  // The added user can now read the channel and post in it.
  const detail = await worker.fetch(`http://localhost/api/v1/channels/${channelId}`, {
    headers: { cookie: bob },
  });
  expect(detail.status).toBe(200);

  const post = await worker.fetch(`http://localhost/api/v1/channels/${channelId}/posts`, {
    method: "POST",
    headers: { cookie: bob, "content-type": "application/json" },
    body: JSON.stringify({ message: "added by admin", clientToken: "add-member-post-1" }),
  });
  expect(post.status).toBe(201);
});

test("adding an existing channel member is idempotent", async () => {
  const res = await addMemberBy(admin, bobId);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("admin cannot add a user who is not a team member", async () => {
  const res = await addMemberBy(admin, carolId);
  expect(res.status).toBe(422);
});

test("a channel member who is not an admin cannot add users", async () => {
  const res = await addMemberBy(bob, carolId);
  expect(res.status).toBe(403);
});

test("channel detail reports the caller's role", async () => {
  const asAdmin = await worker.fetch(`http://localhost/api/v1/channels/${channelId}`, {
    headers: { cookie: admin },
  });
  expect(asAdmin.status).toBe(200);
  const adminBody = (await asAdmin.json()) as { channel: { callerRole?: string } };
  expect(adminBody.channel.callerRole).toBe("admin");

  const asBob = await worker.fetch(`http://localhost/api/v1/channels/${channelId}`, {
    headers: { cookie: bob },
  });
  expect(asBob.status).toBe(200);
  const bobBody = (await asBob.json()) as { channel: { callerRole?: string } };
  expect(bobBody.channel.callerRole).toBe("member");
});
