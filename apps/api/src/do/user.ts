import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { count } from "drizzle-orm";
import { channelDoName, helloEvent, parseClientFrame, verifyInternalToken } from "protocol";
import migrations from "../../migrations/user-do/migrations";
import { getDb } from "../db/client.ts";
import { getChannel } from "../db/repos/channels.ts";
import * as schema from "../db/schema-user-do.ts";

export class UserDO extends DurableObject<Env> {
  db: ReturnType<typeof drizzle>;
  disconnectUntil = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema, logger: false });
    void ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations);
      this.disconnectUntil = (await ctx.storage.get<number>("disconnectUntil")) ?? 0;
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async push(body: { channelId?: string; events: unknown[] }): Promise<void> {
    for (const ev of body.events) {
      const payload = JSON.stringify({
        type: "channel.event",
        channelId: body.channelId,
        event: ev,
      });
      for (const ws of this.ctx.getWebSockets()) {
        if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      }
    }
  }

  async channelsSubscribe(channelIds: string[]): Promise<void> {
    await this.db.delete(schema.channelsCache);
    if (channelIds.length === 0) return;
    await this.db.insert(schema.channelsCache).values(channelIds.map((id) => ({ channelId: id })));
  }

  async forceDisconnect(): Promise<void> {
    this.disconnectUntil = Date.now() + 30_000;
    for (const ws of this.ctx.getWebSockets()) {
      ws.close(4003, "banned");
    }
    await this.ctx.storage.put("disconnectUntil", this.disconnectUntil);
  }

  async health(): Promise<{ ok: boolean; devices: number; channels: number }> {
    const devices = this.ctx.getWebSockets().length;
    const rows = await this.db.select({ n: count() }).from(schema.channelsCache);
    const channels = Number(rows[0]?.n ?? 0);
    return { ok: true, devices, channels };
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
      });
      this.ctx.acceptWebSocket(server, [`device:${deviceId}`]);
      server.send(JSON.stringify(helloEvent(this.ctx.id.toString())));
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const data = typeof message === "string" ? message : new TextDecoder().decode(message);
    const frame = parseClientFrame(data);
    if (!frame) return;
    if (frame.type === "echo") {
      ws.send(JSON.stringify({ type: "echo", data: frame.data }));
    }
    if (frame.type === "post_message") {
      const attachment = ws.deserializeAttachment() as { userId?: string } | null;
      const userId = attachment?.userId;
      if (!userId) return;
      const channelId = frame.channelId;
      const db = getDb(this.env.DB);
      const ch = await getChannel(db, channelId);
      if (!ch || ch.archivedAt) {
        ws.send(
          JSON.stringify({
            type: "error",
            clientToken: frame.clientToken,
            code: "archived_or_not_found",
            message: "channel unavailable",
          }),
        );
        return;
      }
      const stub = this.env.CHANNEL_DO.get(
        this.env.CHANNEL_DO.idFromName(channelDoName(channelId)),
      );
      const res = await stub.postMessage(userId, {
        content: frame.content,
        parentId: frame.parentId,
        clientToken: frame.clientToken,
      });
      if ("error" in res) {
        ws.send(
          JSON.stringify({
            type: "error",
            clientToken: frame.clientToken,
            code: `http_${res.status}`,
            message: res.error,
          }),
        );
      } else {
        ws.send(
          JSON.stringify({
            type: "ack",
            clientToken: frame.clientToken,
            channelId,
            messageId: res.messageId,
            seq: res.seq,
          }),
        );
      }
    }
    if (frame.type === "sync") {
      for (const ch of frame.channels.slice(0, 8)) {
        const stub = this.env.CHANNEL_DO.get(
          this.env.CHANNEL_DO.idFromName(channelDoName(ch.channelId)),
        );
        const body = await stub.history({ afterSeq: ch.lastSeq, limit: 500 });
        if (body.messages.length >= 500) {
          ws.send(JSON.stringify({ type: "sync.gap", channelId: ch.channelId }));
          continue;
        }
        ws.send(
          JSON.stringify({
            type: "sync.result",
            channelId: ch.channelId,
            messages: body.messages.reverse(),
          }),
        );
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean) {
    ws.close(code, reason);
  }

  async webSocketError(_ws: WebSocket, error: unknown) {
    console.error("WebSocket error:", error);
  }
}
