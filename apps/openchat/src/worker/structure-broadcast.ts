import { and, eq, inArray } from "drizzle-orm";
import { channelDoName, userDoName, type ServerEvent } from "protocol";
import { getDb } from "./db/client.ts";
import { teamMembers, userStatus } from "./db/schema-d1.ts";

async function deliver(env: Env, userId: string, event: ServerEvent) {
  const id = env.USER_DO.idFromName(userDoName(userId));
  await env.USER_DO.get(id).pushStructure(event);
}

export function createChannelBroadcaster(env: Env, channelId: string) {
  return {
    async broadcast(event: ServerEvent) {
      const stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
      const targets = await stub.structureTargets();
      await Promise.all(targets.map((uid) => deliver(env, uid, event)));
    },
  };
}

export function createTeamBroadcaster(env: Env, teamId: string) {
  return {
    async broadcast(event: ServerEvent, extraTargets: string[] = []) {
      const db = getDb(env.DB);
      const rows = await db
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId));
      const ids = [...new Set([...rows.map((r) => r.userId), ...extraTargets])];
      if (ids.length === 0) return;
      const online = await db
        .select({ userId: userStatus.userId })
        .from(userStatus)
        .where(and(inArray(userStatus.userId, ids), eq(userStatus.online, true)));
      const onlineSet = new Set(online.map((r) => r.userId));
      await Promise.all(
        ids.filter((uid) => onlineSet.has(uid)).map((uid) => deliver(env, uid, event)),
      );
    },
  };
}
