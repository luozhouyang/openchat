import { env } from "cloudflare:workers";
import { expect, test, beforeAll } from "vite-plus/test";
import { channelDoName } from "protocol";

const stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName("c-react")));
let msgSeq = 0;

beforeAll(async () => {
  await stub.membersAdd({ userId: "alice", role: "member" });
  const post = await stub.postMessage("alice", {
    content: "react to me",
    clientToken: "react-msg",
  });
  if ("error" in post) {
    throw new Error(post.error);
  }
  msgSeq = post.seq;
});

test("toggle reaction on and off", async () => {
  expect(await stub.toggleReaction("alice", { messageSeq: msgSeq, emoji: "👍" })).toBeUndefined();
  expect(await stub.reactionSnapshot(msgSeq)).toEqual({ "👍": ["alice"] });
  expect(await stub.toggleReaction("alice", { messageSeq: msgSeq, emoji: "👍" })).toBeUndefined();
  expect(await stub.reactionSnapshot(msgSeq)).toEqual({});
});

test("invalid emoji rejected", async () => {
  const res = await stub.toggleReaction("alice", { messageSeq: msgSeq, emoji: "not-an-emoji" });
  expect(res).toEqual({ error: "invalid emoji", status: 422 });
});

test("non-member toggle rejected", async () => {
  const res = await stub.toggleReaction("mallory", { messageSeq: msgSeq, emoji: "👍" });
  expect(res).toEqual({ error: "not a member", status: 403 });
});

test("reaction on missing message rejected", async () => {
  const res = await stub.toggleReaction("alice", { messageSeq: 999999, emoji: "👍" });
  expect(res).toEqual({ error: "message not found", status: 404 });
});
