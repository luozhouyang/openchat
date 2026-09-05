import { env } from "cloudflare:workers";
import { expect, test, beforeAll } from "vite-plus/test";
import { channelDoName } from "protocol";

const channelId = "c-mention";
const channel = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));

async function unread(userId: string) {
  const res = await channel.unread(userId);
  expect(res).not.toHaveProperty("error");
  return res as { maxSeq: number; lastReadSeq: number; mentionCount: number };
}

beforeAll(async () => {
  await channel.membersAdd({ userId: "alice", role: "member" });
  await channel.membersAdd({ userId: "bob", role: "member" });
});

test("mention increments count for target only", async () => {
  const res = await channel.postMessage("alice", {
    content: "hey @[bob] check this",
    clientToken: "mention-1",
  });
  expect(res).not.toHaveProperty("error");
  expect((await unread("bob")).mentionCount).toBe(1);
  expect((await unread("alice")).mentionCount).toBe(0);
});

test("mention of non-member ignored", async () => {
  const res = await channel.postMessage("alice", {
    content: "hey @[ghost]",
    clientToken: "mention-2",
  });
  expect(res).not.toHaveProperty("error");
  expect((await unread("bob")).mentionCount).toBe(1);
});

test("self-mention does not increment sender count", async () => {
  const res = await channel.postMessage("alice", {
    content: "note to self @[alice]",
    clientToken: "mention-3",
  });
  expect(res).not.toHaveProperty("error");
  expect((await unread("alice")).mentionCount).toBe(0);
});

test("duplicate mentions are deduplicated", async () => {
  const res = await channel.postMessage("alice", {
    content: "ping @[bob] twice @[bob]",
    clientToken: "mention-4",
  });
  expect(res).not.toHaveProperty("error");
  expect((await unread("bob")).mentionCount).toBe(2);
});

test("mentions column is persisted in history", async () => {
  const body = await channel.history({ limit: 10, order: "asc" });
  const first = body.messages.find((m) => m.content === "hey @[bob] check this");
  expect(first?.mentions).toEqual(["bob"]);
  const second = body.messages.find((m) => m.content === "hey @[ghost]");
  expect(second?.mentions).toBeNull();
  const self = body.messages.find((m) => m.content === "note to self @[alice]");
  expect(self?.mentions).toEqual(["alice"]);
});
