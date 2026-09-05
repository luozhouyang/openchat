import { channelDoName } from "protocol";
import type { Db } from "@worker/db/types";
import { getChannelMember } from "@worker/db/repos/channels";
import { apiError } from "@worker/lib/errors";

function channelStub(env: Env, channelId: string) {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
}

async function requireChannelMember(db: Db, channelId: string, userId: string) {
  const member = await getChannelMember(db, channelId, userId);
  if (!member) {
    throw apiError("forbidden", "not a member", 403);
  }
  return member;
}

export async function postMessage(
  db: Db,
  env: Env,
  input: {
    channelId: string;
    userId: string;
    content: string;
    parentId?: string;
    clientToken?: string;
  },
) {
  await requireChannelMember(db, input.channelId, input.userId);
  const stub = channelStub(env, input.channelId);
  const res = await stub.postMessage(input.userId, {
    content: input.content,
    parentId: input.parentId,
    clientToken: input.clientToken ?? crypto.randomUUID(),
    type: "text",
  });
  if ("error" in res) {
    throw apiError(res.error, res.error, res.status);
  }
  return { messageId: res.messageId, seq: res.seq };
}

export async function editMessage(
  db: Db,
  env: Env,
  input: { channelId: string; callerUserId: string; messageId: string; content: string },
) {
  await requireChannelMember(db, input.channelId, input.callerUserId);
  const stub = channelStub(env, input.channelId);
  const res = await stub.editMessage(input.callerUserId, {
    messageId: input.messageId,
    content: input.content,
  });
  if ("error" in res) {
    throw apiError(res.error, res.error, res.status);
  }
  return { ok: true };
}

export async function deleteMessage(
  db: Db,
  env: Env,
  input: { channelId: string; callerUserId: string; messageId: string },
) {
  await requireChannelMember(db, input.channelId, input.callerUserId);
  const stub = channelStub(env, input.channelId);
  const res = await stub.deleteMessage(input.callerUserId, { messageId: input.messageId });
  if ("error" in res) {
    throw apiError(res.error, res.error, res.status);
  }
  return { ok: true };
}

export async function getMessageHistory(
  env: Env,
  input: {
    channelId: string;
    limit?: number;
    beforeSeq?: number;
    parentId?: string;
    order?: "asc" | "desc";
  },
) {
  const stub = channelStub(env, input.channelId);
  const res = await stub.history({
    limit: input.limit,
    beforeSeq: input.beforeSeq,
    parentId: input.parentId,
    order: input.order,
  });
  return { messages: res.messages, oldestSeq: res.oldestSeq };
}
