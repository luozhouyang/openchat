import { expect, test } from "vite-plus/test";
import { env } from "cloudflare:test";
import { channelDoName } from "protocol";

function channelStub() {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName("c-test")));
}

test("setPresence online/offline lifecycle", async () => {
  const stub = channelStub();
  await stub.membersAdd({ userId: "u1", role: "member" });
  await stub.setPresence({ userId: "u1", online: true });
  let health = await stub.health();
  expect(health.ok).toBe(true);
  expect(health.members).toBe(1);
  expect(health.online).toBe(1);
  await stub.setPresence({ userId: "u1", online: false });
  health = await stub.health();
  expect(health.online).toBe(0);
});

test("setPresence is a no-op for non-members", async () => {
  const stub = channelStub();
  await stub.setPresence({ userId: "ghost", online: true });
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
