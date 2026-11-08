import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import {
  channelDoName,
  GlobalSearchQuery,
  type ChannelSummary,
  type GlobalSearchHit,
  type GlobalSearchOutput,
  type PostOutput,
} from "protocol";
import { requireSession } from "@worker/auth/session";
import { getDb } from "@worker/db/client";
import { channelMembers, channels as channelsTable } from "@worker/db/schema-d1";
import { zodValidator } from "@worker/lib/validation";

/** Channels scanned per query; keeps the fan-out bounded on large workspaces. */
const MAX_CHANNELS = 50;
/** Hits requested per channel before the global top-N cut. */
const PER_CHANNEL = 10;

export const searchV1 = new Hono<{ Bindings: Env }>();

searchV1.get("/search", requireSession, zodValidator("query", GlobalSearchQuery), async (c) => {
  const db = getDb(c.env.DB);
  const me = c.get("session")!.user.id;
  const query = c.req.valid("query");
  const term = query.q.trim();
  const limit = query.limit ?? 50;
  if (term.length === 0) {
    return c.json({ hits: [] } satisfies GlobalSearchOutput);
  }

  const memberships = await db
    .select({ channelId: channelMembers.channelId })
    .from(channelMembers)
    .where(eq(channelMembers.userId, me))
    .limit(MAX_CHANNELS);
  const channelIds = memberships.map((row) => row.channelId);
  if (channelIds.length === 0) {
    return c.json({ hits: [] } satisfies GlobalSearchOutput);
  }

  const rows = await db.select().from(channelsTable).where(inArray(channelsTable.id, channelIds));
  const byId = new Map(rows.map((row) => [row.id, row]));

  const hits: GlobalSearchHit[] = [];
  for (const channelId of channelIds) {
    const channel = byId.get(channelId);
    if (!channel) {
      continue;
    }
    const stub = c.env.CHANNEL_DO.get(c.env.CHANNEL_DO.idFromName(channelDoName(channelId)));
    const found = await stub.searchMessages({ query: term, limit: PER_CHANNEL }).catch(() => null);
    if (!found) {
      continue;
    }
    const summary: ChannelSummary = {
      id: channel.id,
      teamId: channel.teamId,
      name: channel.name,
      displayName: channel.displayName,
      type: channel.type as ChannelSummary["type"],
      member: true,
      archivedAt: channel.archivedAt,
    };
    for (const message of found.messages as PostOutput[]) {
      hits.push({ message, channel: summary });
    }
  }

  hits.sort((a, b) => b.message.createdAt - a.message.createdAt);
  return c.json({ hits: hits.slice(0, limit) } satisfies GlobalSearchOutput);
});
