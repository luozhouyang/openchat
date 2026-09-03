import { expect, test, beforeAll } from "vite-plus/test";
import { env } from "cloudflare:test";
import { channelDoName } from "protocol";
import { getDb } from "../../../src/worker/db/client.ts";
import { addChannelMember, createChannel } from "../../../src/worker/db/repos/channels.ts";
import { createTeam } from "../../../src/worker/db/repos/teams.ts";
import {
  postMessage,
  editMessage,
  deleteMessage,
  getMessageHistory,
} from "../../../src/worker/services/message.service.ts";

const OWNER = "msg-svc-alice";
const OUTSIDER = "msg-svc-bob";
const TEAM = "msg-svc-team";
const CHANNEL = "msg-svc-channel";

function channelStub() {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(CHANNEL)));
}

beforeAll(async () => {
  const db = getDb(env.DB);
  await createTeam(db, {
    id: TEAM,
    name: TEAM,
    displayName: "MsgCo",
    type: "open",
    inviteCode: null,
    creatorId: OWNER,
  });
  await createChannel(db, {
    id: CHANNEL,
    teamId: TEAM,
    name: "svc",
    displayName: "Svc",
    type: "public",
    dedupKey: null,
    creatorId: OWNER,
  });
  await channelStub().membersAdd({ userId: OWNER, role: "admin" });
});

test("postMessage rejects non-member with 403", async () => {
  const db = getDb(env.DB);
  await expect(
    postMessage(db, env, {
      channelId: CHANNEL,
      userId: OUTSIDER,
      content: "should fail",
      clientToken: "nm-1",
    }),
  ).rejects.toMatchObject({ status: 403, code: "forbidden" });
});

test("postMessage happy path returns messageId and seq", async () => {
  const db = getDb(env.DB);
  const res = await postMessage(db, env, {
    channelId: CHANNEL,
    userId: OWNER,
    content: "hello from service",
    clientToken: "svc-post-1",
  });
  expect(typeof res.messageId).toBe("string");
  expect(typeof res.seq).toBe("number");
  expect(res.seq).toBeGreaterThanOrEqual(1);
});

test("editMessage happy path updates content", async () => {
  const db = getDb(env.DB);
  const { messageId } = await postMessage(db, env, {
    channelId: CHANNEL,
    userId: OWNER,
    content: "original",
    clientToken: "svc-edit-1",
  });
  await expect(
    editMessage(db, env, {
      channelId: CHANNEL,
      callerUserId: OWNER,
      messageId,
      content: "edited",
    }),
  ).resolves.toEqual({ ok: true });
  const { messages } = await getMessageHistory(env, { channelId: CHANNEL, limit: 10 });
  const target = messages.find((m) => m.id === messageId)!;
  expect(target.content).toBe("edited");
});

test("deleteMessage happy path soft-deletes", async () => {
  const db = getDb(env.DB);
  const { messageId } = await postMessage(db, env, {
    channelId: CHANNEL,
    userId: OWNER,
    content: "to delete",
    clientToken: "svc-del-1",
  });
  await expect(
    deleteMessage(db, env, { channelId: CHANNEL, callerUserId: OWNER, messageId }),
  ).resolves.toEqual({ ok: true });
  const { messages } = await getMessageHistory(env, { channelId: CHANNEL, limit: 10 });
  const target = messages.find((m) => m.id === messageId)!;
  expect(target.deletedAt).not.toBeNull();
  expect(target.content).toBe("");
});

test("editMessage non-author rejected with 403", async () => {
  const db = getDb(env.DB);
  const { messageId } = await postMessage(db, env, {
    channelId: CHANNEL,
    userId: OWNER,
    content: "mine",
    clientToken: "svc-nonauthor-1",
  });
  await channelStub().membersAdd({ userId: OUTSIDER, role: "member" });
  await addChannelMember(db, { channelId: CHANNEL, userId: OUTSIDER, roles: "channel_user" });
  await expect(
    editMessage(db, env, {
      channelId: CHANNEL,
      callerUserId: OUTSIDER,
      messageId,
      content: "hacked",
    }),
  ).rejects.toMatchObject({ status: 403 });
});
