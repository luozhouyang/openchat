import { Hono } from "hono";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  MarkNotificationsReadInput,
  NotificationsQuery,
  type NotificationsOutput,
  type NotificationItem,
} from "protocol";
import { requireSession } from "@worker/auth/session";
import { getDb } from "@worker/db/client";
import { notifications } from "@worker/db/schema-d1";
import { zodValidator } from "@worker/lib/validation";

export const notificationsV1 = new Hono<{ Bindings: Env }>();

notificationsV1.get(
  "/users/me/notifications",
  requireSession,
  zodValidator("query", NotificationsQuery),
  async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get("session")!.user.id;
    const limit = c.req.valid("query").limit ?? 50;
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
    const unread = await db
      .select({ n: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    const out: NotificationsOutput = {
      notifications: rows.map((row): NotificationItem => ({
        id: row.id,
        kind: row.kind as NotificationItem["kind"],
        channelId: row.channelId,
        messageId: row.messageId,
        seq: row.seq,
        actorId: row.actorId,
        preview: row.preview,
        createdAt: row.createdAt,
        readAt: row.readAt,
      })),
      unread: Number(unread[0]?.n ?? 0),
    };
    return c.json(out);
  },
);

notificationsV1.post(
  "/users/me/notifications/read",
  requireSession,
  zodValidator("json", MarkNotificationsReadInput),
  async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get("session")!.user.id;
    const ids = c.req.valid("json").ids;
    await db
      .update(notifications)
      .set({ readAt: Date.now() })
      .where(
        ids && ids.length > 0
          ? and(eq(notifications.userId, userId), inArray(notifications.id, ids))
          : eq(notifications.userId, userId),
      );
    return c.json({ ok: true });
  },
);
