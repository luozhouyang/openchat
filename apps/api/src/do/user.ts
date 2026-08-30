import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { helloEvent, parseClientFrame, verifyInternalToken } from "protocol";
import migrations from "../../migrations/user-do/migrations";

export class UserDO extends DurableObject<Env> {
  db: ReturnType<typeof drizzle>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { logger: false });
    void ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations);
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
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
      });
      this.ctx.acceptWebSocket(server, [`device:${deviceId}`]);
      server.send(JSON.stringify(helloEvent(this.ctx.id.toString())));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/health") {
      const devices = this.ctx.getWebSockets().length;
      const channels =
        this.ctx.storage.sql.exec("SELECT count(*) AS n FROM channels_cache").toArray()[0]?.n ?? 0;
      return Response.json({ ok: true, devices, channels });
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
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean) {
    ws.close(code, reason);
  }

  async webSocketError(_ws: WebSocket, error: unknown) {
    console.error("WebSocket error:", error);
  }
}
