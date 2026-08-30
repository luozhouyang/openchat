import { userDoName } from "protocol";
import { getDb } from "./db/client.ts";
import { listChannelsForUser } from "./db/repos/channels.ts";

export async function syncUserChannels(env: Env, userId: string) {
  const db = getDb(env.DB);
  const rows = await listChannelsForUser(db, userId);
  const channelIds = rows.map((r) => r.channel.id);
  const id = env.USER_DO.idFromName(userDoName(userId));
  await env.USER_DO.get(id).channelsSubscribe(channelIds);
}
