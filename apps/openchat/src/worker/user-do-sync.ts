import { channelDoName, userDoName } from "protocol";
import { getDb } from "@worker/db/client";
import { listChannelsForUser } from "@worker/db/repos/channels";

/**
 * Reconcile the UserDO channels cache. channelIds may be omitted; when the
 * caller already holds the user's channel set (e.g. the workspaces endpoint),
 * pass it to skip the duplicate D1 membership scan. The DO diffs internally
 * (channelsSubscribe -> {changed}) and only writes when the set actually
 * changed, so this is no longer an unconditional cache rewrite per request.
 */
export async function syncUserChannels(env: Env, userId: string, channelIds?: string[]) {
  const ids =
    channelIds ?? (await listChannelsForUser(getDb(env.DB), userId)).map((r) => r.channel.id);
  const id = env.USER_DO.idFromName(userDoName(userId));
  return env.USER_DO.get(id).channelsSubscribe(ids);
}

export async function syncChannelMember(
  env: Env,
  channelId: string,
  userId: string,
  roles: string,
) {
  const id = env.CHANNEL_DO.idFromName(channelDoName(channelId));
  await env.CHANNEL_DO.get(id).membersAdd({ userId, role: roles });
}

export async function removeChannelMemberFromDo(env: Env, channelId: string, userId: string) {
  const id = env.CHANNEL_DO.idFromName(channelDoName(channelId));
  await env.CHANNEL_DO.get(id).membersRemove({ userId });
}

export async function postFileMessage(
  env: Env,
  channelId: string,
  userId: string,
  attachment: { fileId: string; key: string; name: string; size: number; mime: string },
): Promise<string> {
  const stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
  const res = await stub.postMessage(userId, {
    content: "",
    type: "file",
    clientToken: `file-${attachment.fileId}`,
    attachments: [attachment],
  });
  if ("error" in res) {
    throw new Error(`post file message failed: ${res.status}`);
  }
  return res.messageId;
}
