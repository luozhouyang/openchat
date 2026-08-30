import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { channelDoName } from "protocol";

const channelId = "c-unread";
const channel = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));

async function postMessage(userId: string, content: string, clientToken: string) {
  const res = await channel.postMessage(userId, { content, clientToken });
  expect(res).not.toHaveProperty("error");
  return res as { messageId: string; seq: number };
}

async function unread(userId: string) {
  const res = await channel.unread(userId);
  expect(res).not.toHaveProperty("error");
  return res as { maxSeq: number; lastReadSeq: number; mentionCount: number };
}

beforeAll(async () => {
  await channel.membersAdd({ userId: "alice", role: "member" });
  await channel.membersAdd({ userId: "bob", role: "member" });
});

test("unread grows with messages and clears on mark_read", async () => {
  await postMessage("alice", "one", "ur-1");
  await postMessage("alice", "two", "ur-2");
  const bobUnread = await unread("bob");
  expect(bobUnread.maxSeq - bobUnread.lastReadSeq).toBe(2);

  const mark = await channel.readMark({ userId: "bob", seq: bobUnread.maxSeq });
  expect(mark).toEqual({ lastReadSeq: bobUnread.maxSeq });
  const after = await unread("bob");
  expect(after.maxSeq - after.lastReadSeq).toBe(0);
  expect(after.mentionCount).toBe(0);
});

test("mark_read is idempotent for lower seq", async () => {
  const before = await unread("bob");
  const mark = await channel.readMark({ userId: "bob", seq: 0 });
  expect(mark).toEqual({ lastReadSeq: before.lastReadSeq });
  const after = await unread("bob");
  expect(after.lastReadSeq).toBe(before.lastReadSeq);
});

test("readMark rejects non-member", async () => {
  expect(await channel.readMark({ userId: "ghost", seq: 1 })).toEqual({
    error: "not a member",
    status: 403,
  });
});

test("unread rejects non-member", async () => {
  expect(await channel.unread("ghost")).toEqual({ error: "not a member", status: 403 });
});
