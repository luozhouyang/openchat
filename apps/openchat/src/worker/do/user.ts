import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { asc, count, eq } from "drizzle-orm";
import { channelDoName, helloEvent, parseClientFrame, verifyInternalToken } from "protocol";
import type { PresenceStatus } from "protocol";
import migrations from "../../../migrations/user-do/migrations";
import { getDb } from "../db/client.ts";
import { listChannelsByIds } from "../db/repos/channels.ts";
import * as schema from "../db/schema-user-do.ts";
import * as schemaD1 from "../db/schema-d1.ts";

interface SidebarEntry {
  channelId: string;
  maxSeq: number;
  lastReadSeq: number;
  unread: number;
  mentions: number;
  preview: string | null;
  lastMessageAt: number | null;
}

interface SidebarCategoryChannel {
  channelId: string;
  sortOrder: number;
  unread: number;
  mentions: number;
  preview: string | null;
  lastMessageAt: number | null;
}

interface SidebarCategory {
  id: string;
  userId: string;
  teamId: string | null;
  sortOrder: number | null;
  sorting: string | null;
  type: string | null;
  displayName: string | null;
  muted: boolean;
  collapsed: boolean;
  channels: SidebarCategoryChannel[];
}

interface UserStatus {
  userId: string;
  status: string;
  manual: boolean;
  lastActivityAt: number | null;
  dndEndTime: number | null;
  prevStatus: string | null;
}

export class UserDO extends DurableObject<Env> {
  db: ReturnType<typeof drizzle>;
  disconnectUntil = 0;
  private lastTyping = new Map<string, number>();
  private lastActiveAt = 0;
  private awayAlarmAt = 0;
  private awayNotified = false;
  private recentPush = new Map<string, number>();

  get userId(): string {
    return this.ctx.id.name?.replace(/^user:/, "") ?? "";
  }

  private status(): PresenceStatus {
    if (this.ctx.getWebSockets().length === 0) return "offline";
    if (Date.now() - this.lastActivity() > 5 * 60_000) return "away";
    return "online";
  }

  private lastActivity(): number {
    let last = this.lastActiveAt;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as { lastActivity?: number } | null;
      if (att?.lastActivity) last = Math.max(last, att.lastActivity);
    }
    return last;
  }

  private armAwayAlarm(base = Date.now()): Promise<void> {
    const awayAt = base + 5 * 60_000;
    if (this.awayAlarmAt > awayAt) return Promise.resolve();
    this.awayAlarmAt = awayAt;
    return this.ctx.storage.setAlarm(awayAt);
  }

  private async persistStatus(status: PresenceStatus): Promise<void> {
    // Single source of truth: D1 `user_status` (Mattermost-style global status
    // row). The `online` boolean reflects *connectivity* (derived status, not
    // the effective/manual one) so a manual "dnd/offline" user still receives
    // real-time frames; `status` stores the effective status for display.
    const db = getDb(this.env.DB);
    const rows = await db
      .select()
      .from(schemaD1.userStatus)
      .where(eq(schemaD1.userStatus.userId, this.userId))
      .limit(1);
    const existing = rows[0];
    const lastActivityAt = this.lastActivity() || existing?.lastActivityAt || null;
    const online = status !== "offline";
    if (!existing) {
      await db
        .insert(schemaD1.userStatus)
        .values({
          userId: this.userId,
          online,
          status,
          manual: false,
          lastActivityAt,
          dndEndTime: null,
          prevStatus: null,
          updatedAt: Date.now(),
        })
        .onConflictDoNothing();
      return;
    }
    const effective = existing.manual ? existing.status : status;
    if (
      existing.status === effective &&
      existing.online === online &&
      existing.lastActivityAt === lastActivityAt
    )
      return;
    await db
      .update(schemaD1.userStatus)
      .set({
        status: effective,
        online,
        lastActivityAt,
        ...(existing.status !== effective ? { prevStatus: existing.status } : {}),
        updatedAt: Date.now(),
      })
      .where(eq(schemaD1.userStatus.userId, this.userId));
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema, logger: false });
    void ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations);
      this.disconnectUntil = (await ctx.storage.get<number>("disconnectUntil")) ?? 0;
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async push(body: {
    channelId?: string;
    events: unknown[];
    notifPref?: "all" | "mention" | "none";
  }): Promise<void> {
    const sockets = this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
    for (const ev of body.events) {
      const e = ev as {
        type?: string;
        message?: {
          seq: number;
          userId: string;
          content: string;
          mentions?: string[];
          createdAt?: number;
        };
      };
      if (e.type === "channel.read") {
        const readEvent = e as { channelId: string; lastReadSeq: number };
        await this.db
          .update(schema.sidebarCache)
          .set({ lastReadSeq: readEvent.lastReadSeq, mentionCount: 0, updatedAt: Date.now() })
          .where(eq(schema.sidebarCache.channelId, readEvent.channelId));
        const payload = JSON.stringify({
          type: "channel.read",
          channelId: readEvent.channelId,
          lastReadSeq: readEvent.lastReadSeq,
        });
        for (const ws of sockets) ws.send(payload);
        continue;
      }
      const payload = JSON.stringify({
        type: "channel.event",
        channelId: body.channelId,
        event: ev,
      });
      for (const ws of sockets) ws.send(payload);
      if (body.channelId && e.type === "message.new" && e.message) {
        const existingRows = await this.db
          .select()
          .from(schema.sidebarCache)
          .where(eq(schema.sidebarCache.channelId, body.channelId))
          .limit(1);
        const row = existingRows[0];
        const unread = row ? Math.max(0, e.message.seq - row.lastReadSeq) : e.message.seq;
        const mentions = e.message.mentions?.includes(this.userId)
          ? (row?.mentionCount ?? 0) + 1
          : (row?.mentionCount ?? 0);
        await this.db
          .insert(schema.sidebarCache)
          .values({
            channelId: body.channelId,
            maxSeq: e.message.seq,
            lastMessagePreview: e.message.content.slice(0, 100),
            lastMessageUserId: e.message.userId,
            lastMessageAt: e.message.createdAt ?? Date.now(),
            lastReadSeq: row?.lastReadSeq ?? 0,
            mentionCount: mentions,
            updatedAt: Date.now(),
          })
          .onConflictDoUpdate({
            target: schema.sidebarCache.channelId,
            set: {
              maxSeq: e.message.seq,
              lastMessagePreview: e.message.content.slice(0, 100),
              lastMessageUserId: e.message.userId,
              lastMessageAt: e.message.createdAt ?? Date.now(),
              mentionCount: mentions,
              updatedAt: Date.now(),
            },
          });
        const update = {
          type: "sidebar.update",
          channelId: body.channelId,
          unread,
          mentions,
          lastMessage: {
            preview: e.message.content.slice(0, 100),
            userId: e.message.userId,
            at: e.message.createdAt ?? Date.now(),
          },
        };
        for (const ws of sockets) ws.send(JSON.stringify(update));
      }
    }
    for (const ev of body.events) {
      const e = ev as {
        type?: string;
        message?: { id: string; mentions?: string[] | null; content?: string };
        notifPref?: "all" | "mention" | "none";
      };
      if (e.type !== "message.new" && e.type !== "thread.reply") continue;
      if (!e.message) continue;
      if (!body.channelId) continue;

      const hasActiveForeground = this.ctx.getWebSockets().some((conn) => {
        const att = conn.deserializeAttachment() as { lastActivity?: number } | null;
        return att?.lastActivity !== undefined && Date.now() - att.lastActivity < 30_000;
      });
      if (hasActiveForeground) continue;

      const pref = e.notifPref ?? "all";
      if (pref === "none") continue;
      const mentions = e.message.mentions ?? [];
      if (
        pref === "mention" &&
        !mentions.includes(this.userId) &&
        !this.isBroadcastMention(e.message)
      )
        continue;

      const subs = await this.db.select().from(schema.pushSubscriptions);
      if (subs.length === 0) continue;

      const dedupeKey = `${body.channelId}:${e.message.id}`;
      if ((this.recentPush.get(dedupeKey) ?? 0) > Date.now() - 60_000) continue;
      this.recentPush.set(dedupeKey, Date.now());

      const payload = {
        type: "push-notification",
        userId: this.userId,
        channelId: body.channelId,
        messageId: e.message.id,
        title: body.channelId,
        body: e.message.content?.slice(0, 100) ?? "",
        mentions,
        createdAt: Date.now(),
      };
      try {
        await this.env.PUSH_Q.send(payload);
      } catch (err) {
        console.error("push enqueue failed", err);
      }
    }
  }

  private isBroadcastMention(message: { content?: string }): boolean {
    return /@\[(channel|all)\]/.test(message.content ?? "");
  }

  private async syncPushSubscribedToChannels(subscribed: boolean): Promise<void> {
    const rows = await this.db.select().from(schema.channelsCache);
    await Promise.all(
      rows.map(async (row) => {
        try {
          const stub = this.env.CHANNEL_DO.get(
            this.env.CHANNEL_DO.idFromName(channelDoName(row.channelId)),
          );
          await stub.setPushSubscribed({ userId: this.userId, subscribed });
        } catch {}
      }),
    );
  }

  async sidebar(): Promise<{ channels: SidebarEntry[] }> {
    const channelRows = await this.db.select().from(schema.channelsCache);
    const results: SidebarEntry[] = [];
    const queue = [...channelRows];
    while (queue.length > 0) {
      const batch = queue.splice(0, 8);
      await Promise.all(
        batch.map(async (row) => {
          try {
            const stub = this.env.CHANNEL_DO.get(
              this.env.CHANNEL_DO.idFromName(channelDoName(row.channelId)),
            );
            const unreadInfo = await stub.unread(this.userId);
            if ("error" in unreadInfo) return;
            const metaInfo = await stub.meta();
            results.push({
              channelId: row.channelId,
              maxSeq: unreadInfo.maxSeq,
              lastReadSeq: unreadInfo.lastReadSeq,
              unread: Math.max(0, unreadInfo.maxSeq - unreadInfo.lastReadSeq),
              mentions: unreadInfo.mentionCount,
              preview: metaInfo["last_message_preview"] ?? null,
              lastMessageAt: metaInfo["last_message_at"]
                ? Number(metaInfo["last_message_at"])
                : null,
            });
          } catch {}
        }),
      );
    }
    return { channels: results };
  }

  async channelsSubscribe(channelIds: string[]): Promise<{ changed: boolean }> {
    const existing = await this.db.select().from(schema.channelsCache);
    const current = new Set(existing.map((r) => r.channelId));
    const same = channelIds.length === current.size && channelIds.every((id) => current.has(id));
    if (same) return { changed: false };
    await this.db.delete(schema.channelsCache);
    if (channelIds.length === 0) return { changed: true };
    await this.db.insert(schema.channelsCache).values(channelIds.map((id) => ({ channelId: id })));
    await this.ensureDefaultCategories(this.userId);
    return { changed: true };
  }

  /**
   * Push a structure.update event to every connected device of this user, so
   * clients refetch workspaces/sidebar live instead of on the next navigation
   * (closes the structure-blindness gap flagged in the Mattermost alignment
   * review: no channel_created/member_added polling).
   */
  async structureNotify(body: { scope: "channels" | "teams" }): Promise<{ ok: boolean }> {
    const payload = JSON.stringify({ type: "structure.update", scope: body.scope });
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
    return { ok: true };
  }

  private async ensureDefaultCategories(userId: string): Promise<void> {
    const existing = await this.db
      .select()
      .from(schema.sidebarcategories)
      .where(eq(schema.sidebarcategories.userId, userId));
    if (existing.length === 0) {
      await this.db
        .insert(schema.sidebarcategories)
        .values([
          {
            id: `favorites:${userId}`,
            userId,
            teamId: null,
            sortOrder: 0,
            sorting: "default",
            type: "favorite",
            displayName: "Favorites",
            muted: false,
            collapsed: false,
          },
          {
            id: `channels:${userId}`,
            userId,
            teamId: null,
            sortOrder: 1,
            sorting: "default",
            type: "channels",
            displayName: "Channels",
            muted: false,
            collapsed: false,
          },
          {
            id: `direct_messages:${userId}`,
            userId,
            teamId: null,
            sortOrder: 2,
            sorting: "default",
            type: "direct_messages",
            displayName: "Direct Messages",
            muted: false,
            collapsed: false,
          },
        ])
        .onConflictDoNothing();
    }

    const cacheRows = await this.db.select().from(schema.channelsCache);
    if (cacheRows.length === 0) return;
    const assigned = await this.db
      .select()
      .from(schema.sidebarchannels)
      .where(eq(schema.sidebarchannels.userId, userId));
    const assignedIds = new Set(assigned.map((r) => r.channelId));
    const unassigned = cacheRows.filter((r) => !assignedIds.has(r.channelId));
    if (unassigned.length === 0) return;

    let typeByChannel = new Map<string, string>();
    try {
      const channels = await listChannelsByIds(
        getDb(this.env.DB),
        unassigned.map((r) => r.channelId),
      );
      typeByChannel = new Map(channels.map((c) => [c.id, c.type]));
    } catch {}

    const channelsCatId = `channels:${userId}`;
    const dmCatId = `direct_messages:${userId}`;
    await this.db
      .insert(schema.sidebarchannels)
      .values(
        unassigned.map((row, i) => {
          const type = typeByChannel.get(row.channelId);
          const categoryId = type === "dm" || type === "gm" ? dmCatId : channelsCatId;
          return { channelId: row.channelId, userId, categoryId, sortOrder: i };
        }),
      )
      .onConflictDoNothing();
  }

  async sidebarCategories(userId: string): Promise<{ categories: SidebarCategory[] }> {
    await this.ensureDefaultCategories(userId);
    const cats = await this.db
      .select()
      .from(schema.sidebarcategories)
      .where(eq(schema.sidebarcategories.userId, userId))
      .orderBy(asc(schema.sidebarcategories.sortOrder));
    const rows = await this.db
      .select()
      .from(schema.sidebarchannels)
      .where(eq(schema.sidebarchannels.userId, userId))
      .orderBy(asc(schema.sidebarchannels.sortOrder));
    const cache = await this.db.select().from(schema.sidebarCache);
    const cacheByChannel = new Map(cache.map((r) => [r.channelId, r]));
    const channelsByCategory = new Map<string, SidebarCategoryChannel[]>();
    for (const row of rows) {
      const c = cacheByChannel.get(row.channelId);
      const entry: SidebarCategoryChannel = {
        channelId: row.channelId,
        sortOrder: row.sortOrder ?? 0,
        unread: c ? Math.max(0, c.maxSeq - c.lastReadSeq) : 0,
        mentions: c?.mentionCount ?? 0,
        preview: c?.lastMessagePreview ?? null,
        lastMessageAt: c?.lastMessageAt ?? null,
      };
      const arr = channelsByCategory.get(row.categoryId) ?? [];
      arr.push(entry);
      channelsByCategory.set(row.categoryId, arr);
    }
    const categories = cats.map((cat) => ({
      id: cat.id,
      userId: cat.userId,
      teamId: cat.teamId,
      sortOrder: cat.sortOrder,
      sorting: cat.sorting,
      type: cat.type,
      displayName: cat.displayName,
      muted: cat.muted,
      collapsed: cat.collapsed,
      channels: channelsByCategory.get(cat.id) ?? [],
    }));
    return { categories };
  }

  async forceDisconnect(): Promise<void> {
    this.disconnectUntil = Date.now() + 30_000;
    for (const ws of this.ctx.getWebSockets()) {
      ws.close(4003, "banned");
    }
    await this.ctx.storage.put("disconnectUntil", this.disconnectUntil);
  }

  async health(): Promise<{
    ok: boolean;
    devices: number;
    channels: number;
    disconnectUntil: number;
  }> {
    const devices = this.ctx.getWebSockets().length;
    const rows = await this.db.select({ n: count() }).from(schema.channelsCache);
    const channels = Number(rows[0]?.n ?? 0);
    return { ok: true, devices, channels, disconnectUntil: this.disconnectUntil };
  }

  async presenceStatus(): Promise<{ status: PresenceStatus }> {
    const status = this.status();
    if (status === "away" && !this.awayNotified) {
      this.awayNotified = true;
      await this.persistStatus("away");
    }
    return { status };
  }

  async setStatus(
    userId: string,
    body: { status: string; manual?: boolean; dndEndTime?: number | null },
  ): Promise<{ ok: true }> {
    const db = getDb(this.env.DB);
    const rows = await db
      .select()
      .from(schemaD1.userStatus)
      .where(eq(schemaD1.userStatus.userId, userId))
      .limit(1);
    const existing = rows[0];
    const manual = body.manual ?? false;
    if (existing) {
      await db
        .update(schemaD1.userStatus)
        .set({
          status: body.status,
          manual,
          dndEndTime: body.dndEndTime !== undefined ? body.dndEndTime : existing.dndEndTime,
          prevStatus: manual ? existing.status : existing.prevStatus,
          updatedAt: Date.now(),
        })
        .where(eq(schemaD1.userStatus.userId, userId));
    } else {
      await db.insert(schemaD1.userStatus).values({
        userId,
        online: false,
        status: body.status,
        manual,
        lastActivityAt: Date.now(),
        dndEndTime: body.dndEndTime ?? null,
        prevStatus: null,
        updatedAt: Date.now(),
      });
    }
    return { ok: true };
  }

  async getStatus(userId: string): Promise<UserStatus> {
    const rows = await getDb(this.env.DB)
      .select()
      .from(schemaD1.userStatus)
      .where(eq(schemaD1.userStatus.userId, userId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return {
        userId,
        status: this.status(),
        manual: false,
        lastActivityAt: this.lastActivity() || null,
        dndEndTime: null,
        prevStatus: null,
      };
    }
    return {
      userId,
      status: row.status,
      manual: row.manual,
      lastActivityAt: row.lastActivityAt,
      dndEndTime: row.dndEndTime,
      prevStatus: row.prevStatus,
    };
  }

  async pushSubscribe(body: {
    deviceId: string;
    kind: "webpush" | "fcm" | "apns" | "expo";
    endpoint: string;
    p256dh?: string;
    auth?: string;
  }): Promise<{ ok: boolean }> {
    await this.db
      .insert(schema.pushSubscriptions)
      .values({
        deviceId: body.deviceId,
        kind: body.kind,
        endpoint: body.endpoint,
        p256dh: body.p256dh ?? null,
        auth: body.auth ?? null,
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: schema.pushSubscriptions.deviceId,
        set: {
          kind: body.kind,
          endpoint: body.endpoint,
          p256dh: body.p256dh ?? null,
          auth: body.auth ?? null,
          updatedAt: Date.now(),
        },
      });
    void this.syncPushSubscribedToChannels(true);
    return { ok: true };
  }

  async pushUnsubscribe(body: { deviceId: string }): Promise<{ ok: boolean }> {
    await this.db
      .delete(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.deviceId, body.deviceId));
    const remaining = await this.db.select({ n: count() }).from(schema.pushSubscriptions);
    if (Number(remaining[0]?.n ?? 0) === 0) {
      void this.syncPushSubscribedToChannels(false);
    }
    return { ok: true };
  }

  async listPushSubscriptions(): Promise<{
    subscriptions: (typeof schema.pushSubscriptions.$inferSelect)[];
  }> {
    const rows = await this.db.select().from(schema.pushSubscriptions);
    return { subscriptions: rows };
  }

  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) return;
    if (this.status() === "online") {
      await this.armAwayAlarm(this.lastActivity());
      return;
    }
    if (this.awayNotified) return;
    this.awayNotified = true;
    await this.persistStatus("away");
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      if (Date.now() < this.disconnectUntil) {
        return new Response("banned", { status: 403 });
      }
      const token = request.headers.get("x-internal-token") ?? "";
      if (!(await verifyInternalToken(token, this.env.INTERNAL_TOKEN_KEY))) {
        return new Response("forbidden", { status: 403 });
      }
      const deviceId = url.searchParams.get("deviceId") ?? "unknown";
      for (const old of this.ctx.getWebSockets(`device:${deviceId}`)) {
        old.close(4000, "replaced");
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.serializeAttachment({
        deviceId,
        platform: url.searchParams.get("platform") ?? "web",
        connectedAt: Date.now(),
        userId: url.searchParams.get("sub") ?? null,
        // A fresh connection is itself activity: push suppression sees the
        // device as foreground for the first 30s without waiting for a frame.
        lastActivity: Date.now(),
      });
      this.ctx.acceptWebSocket(server, [`device:${deviceId}`]);
      server.send(JSON.stringify(helloEvent(this.userId)));
      this.lastActiveAt = Date.now();
      this.awayNotified = false;
      await this.armAwayAlarm();
      // Connectivity is the freshness-critical presence fact: write it before
      // accepting so the next broadcast (D1 read) sees this user online.
      await this.persistStatus("online");
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const data = typeof message === "string" ? message : new TextDecoder().decode(message);
    const frame = parseClientFrame(data);
    if (!frame) return;
    // Any valid client frame proves the device is alive: refresh the
    // activity clock that drives presence (away) and push suppression
    // (hasActiveForeground). Without this, a client that never sends the
    // explicit activity frame looks idle and gets spammed with pushes.
    this.touchActivity(ws);
    if (frame.type === "echo") {
      ws.send(JSON.stringify({ type: "echo", data: frame.data }));
    }
    if (frame.type === "mark_read") {
      const attachment = ws.deserializeAttachment() as { userId?: string } | null;
      const userId = attachment?.userId;
      if (!userId) return;
      const id = this.env.CHANNEL_DO.idFromName(channelDoName(frame.channelId));
      void this.env.CHANNEL_DO.get(id).readMark({ userId, seq: frame.seq });
    }
    if (frame.type === "sync") {
      // All channels (protocol cap 500), 8 DO fan-outs at a time — never a
      // silent truncation (system design §4.5).
      for (let i = 0; i < frame.channels.length; i += 8) {
        await Promise.all(
          frame.channels.slice(i, i + 8).map(async (ch) => {
            const stub = this.env.CHANNEL_DO.get(
              this.env.CHANNEL_DO.idFromName(channelDoName(ch.channelId)),
            );
            const body = await stub.history({ afterSeq: ch.lastSeq, limit: 500 });
            if (body.messages.length >= 500) {
              ws.send(JSON.stringify({ type: "sync.gap", channelId: ch.channelId }));
              return;
            }
            ws.send(
              JSON.stringify({
                type: "sync.result",
                channelId: ch.channelId,
                messages: body.messages.reverse(),
              }),
            );
          }),
        );
      }
    }
    if (frame.type === "typing") {
      const attachment = ws.deserializeAttachment() as { userId?: string } | null;
      const userId = attachment?.userId;
      if (!userId) return;
      const now = Date.now();
      if ((this.lastTyping.get(frame.channelId) ?? 0) > now - 3000) return;
      this.lastTyping.set(frame.channelId, now);
      const id = this.env.CHANNEL_DO.idFromName(channelDoName(frame.channelId));
      void this.env.CHANNEL_DO.get(id).typing(userId);
    }
    if (frame.type === "react") {
      const attachment = ws.deserializeAttachment() as { userId?: string } | null;
      const userId = attachment?.userId;
      if (!userId) return;
      const stub = this.env.CHANNEL_DO.get(
        this.env.CHANNEL_DO.idFromName(channelDoName(frame.channelId)),
      );
      const res = await stub.toggleReaction(userId, {
        messageSeq: frame.messageSeq,
        emoji: frame.emoji,
      });
      if (res && "error" in res) {
        ws.send(JSON.stringify({ type: "error", code: `http_${res.status}`, message: res.error }));
      }
    }
    if (frame.type === "subscribe_thread") {
      const attachment = ws.deserializeAttachment() as { userId?: string } | null;
      const userId = attachment?.userId;
      if (!userId) return;
      const stub = this.env.CHANNEL_DO.get(
        this.env.CHANNEL_DO.idFromName(channelDoName(frame.channelId)),
      );
      if (frame.subscribe) {
        await stub.threadsSubscribe({ parentId: frame.parentId, userId });
      } else {
        await stub.threadsUnsubscribe({ parentId: frame.parentId, userId });
      }
    }
    if (frame.type === "activity") {
      this.touchActivity(ws);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean) {
    ws.close(code, reason);
    if (this.ctx.getWebSockets().length === 0) {
      void this.persistStatus("offline");
      void this.ctx.storage.deleteAlarm();
    }
  }

  /**
   * Refresh per-socket + per-DO activity state. Self-heals presence: if the
   * user was flagged away, any traffic brings them back online.
   */
  private touchActivity(ws: WebSocket) {
    const att = ws.deserializeAttachment() as { lastActivity?: number } | null;
    ws.serializeAttachment({ ...att, lastActivity: Date.now() });
    this.lastActiveAt = Date.now();
    if (this.awayNotified) {
      this.awayNotified = false;
      void this.persistStatus("online");
    }
  }

  async webSocketError(_ws: WebSocket, error: unknown) {
    console.error("WebSocket error:", error);
  }
}
