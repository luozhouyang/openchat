import { and, eq, inArray } from "drizzle-orm";
import { channelDoName, userDoName, type ServerEvent } from "protocol";
import { getDb } from "@worker/db/client";
import { teamMembers, userStatus } from "@worker/db/schema-d1";
import { chunkItems } from "@worker/lib/chunks";

export async function deliverStructure(env: Env, userId: string, event: ServerEvent) {
  const id = env.USER_DO.idFromName(userDoName(userId));
  await env.USER_DO.get(id).pushStructure(event);
}

/** Subrequests per fan-out wave; keeps large teams under Workers limits. */
const STRUCTURE_BATCH = 50;

async function deliverAll(env: Env, userIds: string[], event: ServerEvent): Promise<void> {
  for (let index = 0; index < userIds.length; index += STRUCTURE_BATCH) {
    await Promise.all(
      userIds.slice(index, index + STRUCTURE_BATCH).map((uid) => deliverStructure(env, uid, event)),
    );
  }
}

export function createChannelBroadcaster(env: Env, channelId: string) {
  return {
    async broadcast(event: ServerEvent) {
      const stub = env.CHANNEL_DO.get(env.CHANNEL_DO.idFromName(channelDoName(channelId)));
      const targets = await stub.structureTargets();
      await deliverAll(env, targets, event);
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
      if (ids.length === 0) {
        return;
      }
      const online: Array<{ userId: string }> = [];
      for (const chunk of chunkItems(ids)) {
        online.push(
          ...(await db
            .select({ userId: userStatus.userId })
            .from(userStatus)
            .where(and(inArray(userStatus.userId, chunk), eq(userStatus.online, true)))),
        );
      }
      const onlineSet = new Set(online.map((r) => r.userId));
      await deliverAll(
        env,
        ids.filter((uid) => onlineSet.has(uid)),
        event,
      );
    },
  };
}
