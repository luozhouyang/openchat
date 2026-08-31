import { channelDoName } from "protocol";
import { getDb } from "../db/client.ts";
import { getChannelMember } from "../db/repos/channels.ts";
import { apiError } from "../lib/errors.ts";

type Db = ReturnType<typeof getDb>;

function channelStub(env: Env, channelId: string) {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
}

async function requireChannelMember(db: Db, channelId: string, userId: string) {
  const member = await getChannelMember(db, channelId, userId);
  if (!member) throw apiError("forbidden", "not a member", 403);
  return member;
}

export async function postMessageService(
  db: Db,
  env: Env,
  {
    channelId,
    userId,
    content,
    parentId,
    clientToken,
  }: {
    channelId: string;
    userId: string;
    content: string;
    parentId?: string;
    clientToken?: string;
  },
) {
  await requireChannelMember(db, channelId, userId);
  const stub = channelStub(env, channelId);
  const res = await stub.postMessage(userId, {
    content,
    parentId,
    clientToken: clientToken ?? crypto.randomUUID(),
    type: "text",
  });
  if ("error" in res) throw apiError(res.error, res.error, res.status);
  return { messageId: res.messageId, seq: res.seq };
}

export async function editMessageService(
  db: Db,
  env: Env,
  {
    channelId,
    callerUserId,
    messageId,
    content,
  }: {
    channelId: string;
    callerUserId: string;
    messageId: string;
    content: string;
  },
) {
  await requireChannelMember(db, channelId, callerUserId);
  const stub = channelStub(env, channelId);
  const res = await stub.editMessage(callerUserId, { messageId, content });
  if ("error" in res) throw apiError(res.error, res.error, res.status);
  return { ok: true };
}

export async function deleteMessageService(
  db: Db,
  env: Env,
  {
    channelId,
    callerUserId,
    messageId,
  }: {
    channelId: string;
    callerUserId: string;
    messageId: string;
  },
) {
  await requireChannelMember(db, channelId, callerUserId);
  const stub = channelStub(env, channelId);
  const res = await stub.deleteMessage(callerUserId, { messageId });
  if ("error" in res) throw apiError(res.error, res.error, res.status);
  return { ok: true };
}

export async function messageHistory(
  env: Env,
  {
    channelId,
    limit,
    beforeSeq,
    parentId,
    order,
  }: {
    channelId: string;
    limit?: number;
    beforeSeq?: number;
    parentId?: string;
    order?: "asc" | "desc";
  },
) {
  const stub = channelStub(env, channelId);
  const res = await stub.history({ limit, beforeSeq, parentId, order });
  return { messages: res.messages, oldestSeq: res.oldestSeq };
}
