import { env } from "cloudflare:workers";
import { expect, test, beforeAll } from "vite-plus/test";
import { channelDoName } from "protocol";

const stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName("c-thread")));
let rootId = "";

beforeAll(async () => {
  await stub.membersAdd({ userId: "alice", role: "member" });
  const post = await stub.postMessage("alice", {
    content: "root message",
    clientToken: "thread-root",
  });
  if ("error" in post) {
    throw new Error(post.error);
  }
  rootId = post.messageId;
});

test("reply to root is queryable as thread asc", async () => {
  const reply = await stub.postMessage("alice", {
    content: "a reply",
    parentId: rootId,
    clientToken: "thread-reply-1",
  });
  expect(reply).not.toHaveProperty("error");
  const thread = await stub.history({ parentId: rootId, order: "asc" });
  expect(thread.messages.map((m) => m.content)).toEqual(["a reply"]);
});

test("reply to nonexistent parent rejected", async () => {
  const res = await stub.postMessage("alice", {
    content: "orphan",
    parentId: "does-not-exist",
    clientToken: "thread-orphan",
  });
  expect(res).toEqual({ error: "parent not found", status: 422 });
});

test("top-level history excludes thread replies", async () => {
  const top = await stub.history({ limit: 10 });
  expect(top.messages.map((m) => m.content)).toContain("root message");
  expect(top.messages.every((m) => m.content !== "a reply")).toBe(true);
});

test("thread subscribe and unsubscribe lifecycle", async () => {
  await stub.threadsSubscribe({ parentId: rootId, userId: "alice" });
  await stub.threadsSubscribe({ parentId: rootId, userId: "alice" });
  await stub.threadsUnsubscribe({ parentId: rootId, userId: "alice" });
  const reply = await stub.postMessage("alice", {
    content: "after unsubscribe",
    parentId: rootId,
    clientToken: "thread-reply-2",
  });
  expect(reply).not.toHaveProperty("error");
});
