import { and, lt, sql } from "drizzle-orm";
import { getDb } from "@worker/db/client";
import { invites, notifications, uploadsessions } from "@worker/db/schema-d1";

export const NOTIFICATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const INVITE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface MaintenanceReport {
  notifications: number;
  uploadSessions: number;
  invites: number;
}

/** Deletes aged inbox rows, abandoned upload sessions and stale invites. */
export async function runMaintenance(env: Env, now = Date.now()): Promise<MaintenanceReport> {
  const db = getDb(env.DB);
  const deletedNotifications = await db
    .delete(notifications)
    .where(lt(notifications.createdAt, now - NOTIFICATION_RETENTION_MS))
    .returning({ id: notifications.id });
  // Only abandoned sessions: completed uploads keep their row for file lookups.
  const deletedUploads = await db
    .delete(uploadsessions)
    .where(
      and(
        lt(uploadsessions.createdAt, now - UPLOAD_SESSION_TTL_MS),
        sql`coalesce(${uploadsessions.fileOffset}, 0) < coalesce(${uploadsessions.fileSize}, 0)`,
      ),
    )
    .returning({ id: uploadsessions.id });
  const deletedInvites = await db
    .delete(invites)
    .where(lt(invites.expiresAt, now - INVITE_RETENTION_MS))
    .returning({ id: invites.id });
  return {
    notifications: deletedNotifications.length,
    uploadSessions: deletedUploads.length,
    invites: deletedInvites.length,
  };
}
