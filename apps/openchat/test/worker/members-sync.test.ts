import { expect, test } from "vite-plus/test";
import { env } from "cloudflare:test";
import { channelDoName } from "protocol";
import { getDb } from "../../src/worker/db/client.ts";
import * as schemaD1 from "../../src/worker/db/schema-d1.ts";

function channelStub() {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName("c-test")));
}

async function setD1Online(userId: string, online: boolean): Promise<void> {
  await getDb(env.DB)
    .insert(schemaD1.userStatus)
    .values({
      userId,
      online,
      status: online ? "online" : "offline",
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: schemaD1.userStatus.userId,
      set: { online, status: online ? "online" : "offline", updatedAt: Date.now() },
    });
}

test("health reflects online members from D1 user_status", async () => {
  const stub = channelStub();
  await stub.membersAdd({ userId: "u1", role: "member" });
  let health = await stub.health();
  expect(health.ok).toBe(true);
  expect(health.members).toBe(1);
  expect(health.online).toBe(0);

  await setD1Online("u1", true);
  health = await stub.health();
  expect(health.online).toBe(1);

  await setD1Online("u1", false);
  health = await stub.health();
  expect(health.online).toBe(0);
});

test("health ignores online users that are not members", async () => {
  const stub = channelStub();
  await stub.membersAdd({ userId: "u1", role: "member" });
  await setD1Online("ghost", true);
  const health = await stub.health();
  expect(health.online).toBe(0);
});

test("membersAdd is idempotent", async () => {
  const stub = channelStub();
  await stub.membersAdd({ userId: "u1", role: "member" });
  await stub.membersAdd({ userId: "u1", role: "member" });
  const health = await stub.health();
  expect(health.members).toBe(1);
});
