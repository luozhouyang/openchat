import { env } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";
import { inArray } from "drizzle-orm";
import { getDb } from "@worker/db/client";
import { invites, notifications, uploadsessions } from "@worker/db/schema-d1";
import { runMaintenance } from "@worker/maintenance";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const db = getDb(env.DB);

const notificationIds = ["maint-notif-old", "maint-notif-fresh"];
const uploadIds = ["maint-upload-old-incomplete", "maint-upload-old-complete", "maint-upload-new"];
const inviteIds = ["maint-invite-old", "maint-invite-recent"];

test("runMaintenance prunes only aged and abandoned rows", async () => {
  const now = Date.now();

  await db.insert(notifications).values([
    {
      id: "maint-notif-old",
      userId: "maint-user",
      kind: "mention",
      channelId: "maint-channel",
      messageId: "maint-message-old",
      seq: 1,
      actorId: "maint-actor",
      preview: "old mention",
      createdAt: now - 91 * DAY,
    },
    {
      id: "maint-notif-fresh",
      userId: "maint-user",
      kind: "reply",
      channelId: "maint-channel",
      messageId: "maint-message-fresh",
      seq: 2,
      actorId: "maint-actor",
      preview: "fresh reply",
      createdAt: now,
    },
  ]);

  await db.insert(uploadsessions).values([
    {
      id: "maint-upload-old-incomplete",
      createdAt: now - 48 * HOUR,
      fileSize: 10,
      fileOffset: 0,
    },
    {
      id: "maint-upload-old-complete",
      createdAt: now - 48 * HOUR,
      fileSize: 10,
      fileOffset: 10,
    },
    { id: "maint-upload-new", createdAt: now, fileSize: 10, fileOffset: 0 },
  ]);

  await db.insert(invites).values([
    {
      id: "maint-invite-old",
      teamId: "maint-team",
      tokenHash: "maint-hash-old",
      email: "old@test.dev",
      createdBy: "maint-actor",
      createdAt: now - 90 * DAY,
      expiresAt: now - 60 * DAY,
    },
    {
      id: "maint-invite-recent",
      teamId: "maint-team",
      tokenHash: "maint-hash-recent",
      email: "recent@test.dev",
      createdBy: "maint-actor",
      createdAt: now - 2 * DAY,
      expiresAt: now - 1 * DAY,
    },
  ]);

  const report = await runMaintenance(env, now);
  expect(report).toEqual({ notifications: 1, uploadSessions: 1, invites: 1 });

  const remainingNotifications = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(inArray(notifications.id, notificationIds))
    .orderBy(notifications.id);
  expect(remainingNotifications.map((row) => row.id)).toEqual(["maint-notif-fresh"]);

  const remainingUploads = await db
    .select({ id: uploadsessions.id })
    .from(uploadsessions)
    .where(inArray(uploadsessions.id, uploadIds))
    .orderBy(uploadsessions.id);
  expect(remainingUploads.map((row) => row.id)).toEqual([
    "maint-upload-new",
    "maint-upload-old-complete",
  ]);

  const remainingInvites = await db
    .select({ id: invites.id })
    .from(invites)
    .where(inArray(invites.id, inviteIds))
    .orderBy(invites.id);
  expect(remainingInvites.map((row) => row.id)).toEqual(["maint-invite-recent"]);
});
