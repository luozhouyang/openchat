import { expect, test } from "vite-plus/test";
import { env } from "cloudflare:test";
import { channelDoName } from "protocol";

function channelStub() {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName("c-idem")));
}

test("message gets seq and duplicate token returns same seq with deduplicated", async () => {
  const stub = channelStub();
  await stub.membersAdd({ userId: "u1", role: "member" });
  const first = await stub.postMessage("u1", { content: "hello", clientToken: "tok-1" });
  expect(first).not.toHaveProperty("error");
  const r1 = first as { messageId: string; seq: number };
  const second = await stub.postMessage("u1", { content: "hello", clientToken: "tok-1" });
  const r2 = second as { messageId: string; seq: number; deduplicated?: boolean };
  expect(r2.seq).toBe(r1.seq);
  expect(r2.messageId).toBe(r1.messageId);
  expect(r2.deduplicated).toBe(true);
});

test("non-member rejected with 403 semantics", async () => {
  const stub = channelStub();
  const res = await stub.postMessage("stranger", { content: "hi", clientToken: "tok-x" });
  expect(res).toEqual({ error: "not a member", status: 403 });
});

test("oversized content rejected with 422 semantics", async () => {
  const stub = channelStub();
  await stub.membersAdd({ userId: "u1", role: "member" });
  const res = await stub.postMessage("u1", { content: "x".repeat(17000), clientToken: "tok-big" });
  expect(res).toEqual({ error: "invalid", status: 422 });
});
