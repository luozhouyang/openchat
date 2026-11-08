import { channelDoName, type PostAttachment } from "protocol";
import { inArray } from "drizzle-orm";
import type { Db } from "@worker/db/types";
import { getChannelMember } from "@worker/db/repos/channels";
import { linkFileToPost } from "@worker/db/repos/uploads";
import { uploadsessions } from "@worker/db/schema-d1";
import { apiError } from "@worker/lib/errors";

function channelStub(env: Env, channelId: string) {
  return env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
}

/**
 * Draft attachments are upload sessions the caller finished with the
 * `/attach` endpoint; they must belong to the same user and channel.
 */
async function requireAttachmentOwnership(
  db: Db,
  channelId: string,
  userId: string,
  attachments: PostAttachment[],
) {
  const ids = [...new Set(attachments.map((a) => a.fileId))];
  const rows = await db
    .select({
      id: uploadsessions.id,
      userId: uploadsessions.userId,
      channelId: uploadsessions.channelId,
      fileSize: uploadsessions.fileSize,
      fileOffset: uploadsessions.fileOffset,
    })
    .from(uploadsessions)
    .where(inArray(uploadsessions.id, ids));
  if (rows.length !== ids.length) {
    throw apiError("attachment not found", "attachment not found", 404);
  }
  for (const row of rows) {
    if (row.userId !== userId || row.channelId !== channelId) {
      throw apiError("forbidden", "attachment forbidden", 403);
    }
    if (row.fileOffset !== row.fileSize) {
      throw apiError("upload incomplete", "upload incomplete", 409);
    }
  }
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
    attachments?: PostAttachment[];
  },
) {
  await requireChannelMember(db, input.channelId, input.userId);
  if (input.attachments?.length) {
    await requireAttachmentOwnership(db, input.channelId, input.userId, input.attachments);
  }
  const stub = channelStub(env, input.channelId);
  const hasAttachments = (input.attachments?.length ?? 0) > 0;
  const res = await stub.postMessage(input.userId, {
    content: input.content,
    parentId: input.parentId,
    clientToken: input.clientToken ?? crypto.randomUUID(),
    // A post whose only payload is files is a file message; anything with
    // text stays a text post (the client renders both the same way).
    type: hasAttachments && input.content.trim() === "" ? "file" : "text",
    attachments: input.attachments,
  });
  if ("error" in res) {
    throw apiError(res.error, res.error, res.status);
  }
  if (input.attachments?.length) {
    for (const attachment of input.attachments) {
      await linkFileToPost(db, { fileId: attachment.fileId, postId: res.messageId });
    }
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
