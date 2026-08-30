import { expect, test } from "vite-plus/test";
import { env } from "cloudflare:test";
import { channelDoName } from "protocol";

function channelStub() {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName("c-test")));
}

test("member add subscribe unsubscribe lifecycle", async () => {
  const stub = channelStub();
  await stub.membersAdd({ userId: "u1", role: "member" });
  await stub.subscribe({ userId: "u1" });
  let health = await stub.health();
  expect(health.ok).toBe(true);
  expect(health.members).toBe(1);
  expect(health.subscribers).toBe(1);
  await stub.unsubscribe({ userId: "u1" });
  health = await stub.health();
  expect(health.subscribers).toBe(0);
});

test("subscribe rejects non-member", async () => {
  const stub = channelStub();
  const res = await stub.subscribe({ userId: "ghost" });
  expect(res).toEqual({ ok: false });
});

test("membersAdd is idempotent", async () => {
  const stub = channelStub();
  await stub.membersAdd({ userId: "u1", role: "member" });
  await stub.membersAdd({ userId: "u1", role: "member" });
  const health = await stub.health();
  expect(health.members).toBe(1);
});
