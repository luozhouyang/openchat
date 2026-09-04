import { channelDoName, userDoName } from "protocol";
import { getDb } from "./db/client.ts";
import { listChannelsForUser } from "./db/repos/channels.ts";

export async function syncUserChannels(
  env: Env,
  userId: string,
  forceScope?: "channels" | "teams",
) {
  const db = getDb(env.DB);
  const rows = await listChannelsForUser(db, userId);
  const channelIds = rows.map((r) => r.channel.id);
  const id = env.USER_DO.idFromName(userDoName(userId));
  const stub = env.USER_DO.get(id);
  const { changed } = await stub.channelsSubscribe(channelIds);
  // Tell the user's connected devices the structure moved (live refresh
  // instead of polling on navigation). Only on real change — broadcasting on
  // every sync made the workspaces endpoint echo-loop with the client's
  // structure-driven invalidation (~40 req/s of workspaces+sidebar). Callers
  // that mutate team membership without moving the channel set (create/join
  // team) pass forceScope so other devices still refresh live.
  if (changed) await stub.structureNotify({ scope: "channels" });
  else if (forceScope) await stub.structureNotify({ scope: forceScope });
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
  if ("error" in res) throw new Error(`post file message failed: ${res.status}`);
  return res.messageId;
}
