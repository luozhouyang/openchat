import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { channelDoName } from "protocol";

const stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName("c-ed")));
let msgId = "";
let adminMsgId = "";

beforeAll(async () => {
  await stub.membersAdd({ userId: "alice", role: "member" });
  await stub.membersAdd({ userId: "bob", role: "member" });
  await stub.membersAdd({ userId: "carol", role: "channel_admin" });
  const post = await stub.postMessage("alice", { content: "original", clientToken: "ed-msg" });
  if ("error" in post) throw new Error(post.error);
  msgId = post.messageId;
  const post2 = await stub.postMessage("bob", { content: "bob's", clientToken: "ed-msg2" });
  if ("error" in post2) throw new Error(post2.error);
  adminMsgId = post2.messageId;
});

test("author can edit, non-author cannot", async () => {
  expect(await stub.editMessage("alice", { messageId: msgId, content: "edited" })).toEqual({
    ok: true,
  });
  expect(await stub.editMessage("bob", { messageId: msgId, content: "hacked" })).toEqual({
    error: "forbidden",
    status: 403,
  });
  const hist = await stub.history({ limit: 10 });
  const target = hist.messages.find((m) => m.id === msgId)!;
  expect(target.content).toBe("edited");
  expect(target.editedAt).not.toBeNull();
});

test("empty content rejected", async () => {
  expect(await stub.editMessage("alice", { messageId: msgId, content: "" })).toEqual({
    error: "invalid",
    status: 422,
  });
});

test("admin can edit another author's message", async () => {
  expect(await stub.editMessage("carol", { messageId: adminMsgId, content: "by admin" })).toEqual({
    ok: true,
  });
  expect(await stub.deleteMessage("carol", { messageId: adminMsgId })).toEqual({ ok: true });
});

test("delete soft-deletes and clears content in history", async () => {
  expect(await stub.deleteMessage("alice", { messageId: msgId })).toEqual({ ok: true });
  const hist = await stub.history({ limit: 10 });
  const target = hist.messages.find((m) => m.id === msgId)!;
  expect(target.deletedAt).not.toBeNull();
  expect(target.content).toBe("");
  expect(await stub.deleteMessage("alice", { messageId: msgId })).toEqual({ ok: true });
});

test("edit/delete on missing message returns not found", async () => {
  expect(await stub.editMessage("alice", { messageId: "missing-msg", content: "x" })).toEqual({
    error: "not found",
    status: 404,
  });
  expect(await stub.deleteMessage("alice", { messageId: "missing-msg" })).toEqual({
    error: "not found",
    status: 404,
  });
});

test("editing a deleted message returns gone", async () => {
  expect(await stub.editMessage("alice", { messageId: msgId, content: "again" })).toEqual({
    error: "deleted",
    status: 410,
  });
});
