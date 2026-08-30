import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { getDb } from "../src/db/client.ts";
import { createChannel } from "../src/db/repos/channels.ts";

let cookie = "";
let teamId = "";

async function signup(email: string): Promise<string> {
  const res = await exports.default.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "ws-guide-password", name: email.split("@")[0] }),
  });
  return res.headers.get("set-cookie") ?? "";
}

beforeAll(async () => {
  cookie = await signup("ws-guide@test.dev");
  const res = await exports.default.fetch("http://localhost/teams", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "guideteam", displayName: "Guide Team", type: "open" }),
  });
  const body = (await res.json()) as { id?: string };
  teamId = body.id!;
});

test("workspaces returns team with empty channels", async () => {
  const res = await exports.default.fetch("http://localhost/me/workspaces", {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    teams: {
      id: string;
      name: string;
      displayName: string;
      type: string;
      role: string;
      archivedAt: number | null;
      channels: {
        id: string;
        teamId: string | null;
        name: string | null;
        displayName: string;
        type: string;
        member: boolean;
        archivedAt: number | null;
      }[];
    }[];
  };
  expect(body.teams).toHaveLength(1);
  expect(body.teams[0].name).toBe("guideteam");
  expect(body.teams[0].displayName).toBe("Guide Team");
  expect(body.teams[0].type).toBe("open");
  expect(body.teams[0].role).toBe("admin");
  expect(body.teams[0].channels).toHaveLength(0);
});

test("workspaces lists channels and membership", async () => {
  const db = getDb(env.DB);
  await createChannel(db, {
    id: "channel-ws-1",
    teamId,
    name: "general",
    displayName: "General",
    type: "public",
    dedupKey: "dedup-ws-1",
    creatorId: "user-ws-1",
  });

  const res = await exports.default.fetch("http://localhost/me/workspaces", {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    teams: { id: string; channels: { id: string; name: string | null; member: boolean }[] }[];
  };
  expect(body.teams[0].channels).toHaveLength(1);
  expect(body.teams[0].channels[0].name).toBe("general");
  expect(body.teams[0].channels[0].member).toBe(false);

  await createChannel(db, {
    id: "channel-ws-2",
    teamId,
    name: "announce",
    displayName: "Announce",
    type: "public",
    dedupKey: "dedup-ws-2",
    creatorId: "user-ws-1",
  });
  const res2 = await exports.default.fetch("http://localhost/me/workspaces", {
    headers: { cookie },
  });
  const body2 = (await res2.json()) as {
    teams: { channels: { id: string; member: boolean }[] }[];
  };
  expect(body2.teams[0].channels).toHaveLength(2);
});

test("workspaces requires session", async () => {
  const res = await exports.default.fetch("http://localhost/me/workspaces");
  expect(res.status).toBe(401);
});
