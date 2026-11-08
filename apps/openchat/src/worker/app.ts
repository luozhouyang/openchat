import { Hono } from "hono";
import { health } from "@worker/routes/health";
import { internalRoutes } from "@worker/routes/internal";
import { v1Router } from "@worker/routes/v1/index";
import { makeAuth } from "@worker/auth";
import { isHttpError, toErrorBody } from "@worker/lib/errors";

type AppEnv = { Bindings: Env; Variables: { requestId: string } };

const SECURITY_HEADERS: [string, string][] = [
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "no-referrer"],
  ["x-frame-options", "DENY"],
  ["permissions-policy", "geolocation=(), camera=(), microphone=()"],
  ["strict-transport-security", "max-age=31536000; includeSubDomains"],
];

function applySecurityHeaders(c: { header: (name: string, value: string) => void }): void {
  for (const [name, value] of SECURITY_HEADERS) {
    c.header(name, value);
  }
}

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    applySecurityHeaders(c);
    await next();
  });

  // One request id per call, echoed to the client and attached to every log
  // line and error body so support can correlate a report with the logs.
  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    const startedAt = Date.now();
    try {
      await next();
    } finally {
      // The query string is intentionally omitted: it can carry search terms
      // and invite tokens.
      console.info(
        JSON.stringify({
          type: "request",
          requestId,
          method: c.req.method,
          path: new URL(c.req.url).pathname,
          status: (c.res as Response | undefined)?.status ?? 500,
          durationMs: Date.now() - startedAt,
        }),
      );
    }
  });

  app.route("/", health);
  app.route("/api/v1", v1Router);
  app.route("/", internalRoutes);
  app.all("/api/auth/*", async (c) => {
    const auth = makeAuth(c.env);
    return auth.handler(c.req.raw);
  });
  app.onError((err, c) => {
    applySecurityHeaders(c);
    const requestId = c.get("requestId") ?? "";
    if (isHttpError(err)) {
      console.error(
        JSON.stringify({
          type: "request.error",
          requestId,
          code: err.code,
          status: err.status,
        }),
      );
      return c.json(
        { ...toErrorBody(err), requestId },
        err.status as 400 | 403 | 404 | 409 | 422 | 429 | 500,
      );
    }
    console.error(
      JSON.stringify({
        type: "request.error",
        requestId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json({ error: "internal server error", code: "internal", requestId }, 500);
  });
  return app;
}
