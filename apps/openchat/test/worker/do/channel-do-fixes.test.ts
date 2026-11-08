import { env } from "cloudflare:workers";
import { expect, test, beforeAll } from "vite-plus/test";
import { runInDurableObject } from "cloudflare:test";
import { channelDoName } from "protocol";
import * as schema from "@worker/db/schema-channel-do";

// Real user ids look like `usr_<uuidv7>` and contain `-`; lowercase ids like
// `@[all]` / `@[channel]` keywords must not become mentions.
const alice = "usr_a0000000-7f2d-4e88-9f12-1a2b3c4d5e6f";
const bob = "usr_b0000000-8c3e-4d11-b0a5-9f8e7d6c5b4a";

const channelId = "c-do-fixes";
const channel = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));

function memberRows() {
  return runInDurableObject(channel, (instance) =>
    instance.db.select().from(schema.memberState).all(),
  );
}

beforeAll(async () => {
  await channel.membersAdd({ userId: alice, role: "member" });
  await channel.membersAdd({ userId: bob, role: "member" });
});

test("mentions parse usr_ ids with dashes and validate against member_state", async () => {
  const post = await channel.postMessage(alice, {
    content: `hi @[bob_dfake-0000-not-a-member] and @${"[all]"} and @${"[channel]"} and @[usr_z9999999-ffff-4aaa-8fff-000000000001]`,
    clientToken: "fix-mention-0",
  });
  expect(post).not.toHaveProperty("error");

  const mentionsPost = await channel.postMessage(alice, {
    content: `ping @[bob_dfake-0000-not-a-member] @${"[channel]"} pre`,
    clientToken: "fix-mention-1",
  });
  expect(mentionsPost).not.toHaveProperty("error");

  const real = await channel.postMessage(alice, {
    content: `hey @[usr_b0000000-8c3e-4d11-b0a5-9f8e7d6c5b4a]`,
    clientToken: "fix-mention-2",
  });
  if ("error" in real) {
    throw new Error(real.error);
  }
  const rows = (await channel.history({ limit: 10 })).messages;
  const stored = rows.find((m) => m.id === real.messageId);
  expect(stored?.mentions).toEqual([bob]);

  // Badge semantics match the push side: broadcast keywords (@[all]/@[channel]
  // in msgs 0 and 1) highlight every member except the sender (+1 each), and
  // msg 2 adds one direct mention for bob.
  const mentions = (await memberRows()).find((r) => r.userId === bob);
  expect(mentions?.mentionCount).toBe(3);
  // The sender of every message here is alice; broadcast keywords highlight
  // everyone except the sender, so her own badge stays 0.
  expect((await memberRows()).find((r) => r.userId === alice)?.mentionCount).toBe(0);
});

test("deduped repost inside the transaction still returns original message", async () => {
  const first = await channel.postMessage(alice, {
    content: "dedup source",
    clientToken: "fix-dedup-1",
  });
  expect(first).not.toHaveProperty("error");
  if (!("messageId" in first)) {
    throw new Error("unreachable");
  }
  const second = await channel.postMessage(alice, {
    content: "dedup source",
    clientToken: "fix-dedup-1",
  });
  expect(second).toEqual({
    messageId: first.messageId,
    seq: first.seq,
    deduplicated: true,
  });
  const countRows = await runInDurableObject(channel, (instance) =>
    instance.db.select().from(schema.messages).all(),
  );
  expect(countRows.filter((m) => m.content === "dedup source").length).toBe(1);
});

test("editing the last message refreshes meta preview; deleting recomputes it", async () => {
  const cid = "c-do-fixes-meta";
  const ch = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(cid)));
  await ch.membersAdd({ userId: alice, role: "member" });
  await ch.membersAdd({ userId: bob, role: "member" });

  const older = await ch.postMessage(alice, {
    content: "older message text",
    clientToken: "fix-meta-older",
  });
  expect(older).not.toHaveProperty("error");
  const newest = await ch.postMessage(bob, {
    content: "brand new last",
    clientToken: "fix-meta-newest",
  });
  if ("error" in newest) {
    throw new Error(newest.error);
  }
  expect((await ch.meta()).last_message_preview).toBe("brand new last");

  await ch.editMessage(bob, {
    messageId: newest.messageId,
    content: "brand new last (edited)",
  });
  expect((await ch.meta()).last_message_preview).toBe("brand new last (edited)");

  // Editing a non-last message must NOT touch the preview.
  if (!("messageId" in older)) {
    throw new Error("unreachable");
  }
  expect(
    await ch.editMessage(alice, { messageId: older.messageId, content: "older changed" }),
  ).toEqual({ ok: true });
  expect((await ch.meta()).last_message_preview).toBe("brand new last (edited)");

  await ch.deleteMessage(bob, { messageId: newest.messageId });
  const meta = await ch.meta();
  expect(meta.last_message_id).toBe(older.messageId);
  expect(meta.last_message_preview).toBe("older changed");
});

test("removeMember deletes state + subscriptions and is idempotent", async () => {
  const cid = "c-do-fixes-remove";
  const ch = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(cid)));
  const carol = "usr_c0000000-1e2f-4a99-8a44-5c6b7d8e9f01";
  const dave = "usr_d0000000-2e3f-4b88-9b55-6d7c8e9f0a12";
  await ch.membersAdd({ userId: carol, role: "member" });
  await ch.membersAdd({ userId: dave, role: "member" });
  const root = await ch.postMessage(dave, { content: "root", clientToken: "fix-rm-root" });
  if ("error" in root) {
    throw new Error(root.error);
  }
  await ch.threadsSubscribe({ parentId: root.messageId, userId: carol });
  await ch.threadMarkRead(carol, { postId: root.messageId });

  expect(await ch.removeMember(carol)).toBe(true);
  expect(await ch.removeMember(carol)).toBe(false);

  expect(await ch.unread(carol)).toEqual({ error: "not a member", status: 403 });
  const subs = await runInDurableObject(ch, (instance) => ({
    threadSubs: instance.db.select().from(schema.threadSubscriptions).all(),
    threadMemberships: instance.db.select().from(schema.threadMemberships).all(),
  }));
  expect(subs.threadSubs.some((s) => s.userId === carol && s.parentId === root.messageId)).toBe(
    false,
  );
  expect(subs.threadMemberships.some((m) => m.userId === carol)).toBe(false);

  // Remaining member untouched.
  expect(await ch.unread(dave)).not.toHaveProperty("error");
});

test("removeReactionByUser deletes only the target user's reaction", async () => {
  const cid = "c-do-fixes-react";
  const ch = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(cid)));
  const erin = "usr_e0000000-3f4a-4c77-8c66-7e8d9f0a1b23";
  const frank = "usr_f0000000-4f5b-4d66-9d77-8f9e0a1b2c34";
  await ch.membersAdd({ userId: erin, role: "member" });
  await ch.membersAdd({ userId: frank, role: "member" });
  const post = await ch.postMessage(erin, { content: "reactable", clientToken: "fix-rr-root" });
  if ("error" in post) {
    throw new Error(post.error);
  }
  expect(await ch.toggleReaction(erin, { messageSeq: post.seq, emoji: "👍" })).toBeUndefined();
  expect(await ch.toggleReaction(frank, { messageSeq: post.seq, emoji: "👍" })).toBeUndefined();
  expect(await ch.reactionSnapshot(post.seq)).toEqual({ "👍": [erin, frank] });

  expect(await ch.removeReactionByUser(erin, post.seq, "👍")).toBe(true);
  expect(await ch.reactionSnapshot(post.seq)).toEqual({ "👍": [frank] });

  // Idempotent even when nothing is left to remove; wrong-emoji / missing
  // message resolve false (404 semantics for the route layer).
  expect(await ch.removeReactionByUser(erin, post.seq, "👍")).toBe(true);
  expect(await ch.removeReactionByUser(frank, post.seq, "👍")).toBe(true);
  expect(await ch.reactionSnapshot(post.seq)).toEqual({});

  expect(await ch.removeReactionByMessageId(frank, post.messageId ?? "nope", "👍")).toBe(true);
  expect(await ch.removeReactionByMessageId(frank, "does-not-exist", "👍")).toBe(false);
  expect(await ch.removeReactionByUser(frank, post.seq, "nope")).toBe(false);
  expect(await ch.removeReactionByUser(frank, 424242, "👍")).toBe(false);

  const rows = await ch.history({ limit: 10 });
  expect(rows.messages.find((m) => m.seq === post.seq)?.hasReactions).toBe(false);
});

test("alarm purges stale dedup tokens and re-arms for the next UTC hour", async () => {
  const cid = "c-do-fixes-alarm";
  const ch = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(cid)));
  await ch.membersAdd({ userId: "gina", role: "member" });
  const post = await ch.postMessage("gina", { content: "fresh", clientToken: "fix-alarm-fresh" });
  if ("error" in post) {
    throw new Error(post.error);
  }
  await runInDurableObject(ch, (instance) =>
    instance.db
      .insert(schema.dedupTokens)
      .values({
        userId: "gina",
        token: "fix-alarm-stale",
        messageSeq: post.seq,
        createdAt: Date.now() - 25 * 60 * 60 * 1000,
      })
      .run(),
  );

  await runInDurableObject(ch, async (instance) => {
    await instance.alarm();

    const rows = await instance.db.select().from(schema.dedupTokens).all();
    expect(rows.find((r) => r.token === "fix-alarm-stale")).toBeUndefined();
    expect(rows.some((r) => r.token === "fix-alarm-fresh" && r.messageSeq === post.seq)).toBe(true);
    // The alarm re-armed to the top of the next full UTC hour.
    const ctx = (instance as unknown as { ctx: DurableObjectState }).ctx;
    const alarm = await ctx.storage.getAlarm();
    expect(alarm).not.toBeNull();
    if (alarm !== null) {
      expect(Number.isInteger(alarm / 3_600_000)).toBe(true);
      expect(alarm).toBeGreaterThan(Date.now());
    }
  });
});
