import { channelDoName, userDoName } from "protocol";
import { getDb } from "./db/client.ts";
import { listChannelsForUser } from "./db/repos/channels.ts";

export async function syncUserChannels(env: Env, userId: string) {
  const db = getDb(env.DB);
  const rows = await listChannelsForUser(db, userId);
  const channelIds = rows.map((r) => r.channel.id);
  const id = env.USER_DO.idFromName(userDoName(userId));
  await env.USER_DO.get(id).channelsSubscribe(channelIds);
}

export async function syncChannelMember(env: Env, channelId: string, userId: string, role: string) {
  const id = env.CHANNEL_DO.idFromName(channelDoName(channelId));
  await env.CHANNEL_DO.get(id).membersAdd({ userId, role });
  await env.CHANNEL_DO.get(id).subscribe({ userId });
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
  if ("error" in res) throw new Error(`post file message failed: ${res.status}`);
  return res.messageId;
}
