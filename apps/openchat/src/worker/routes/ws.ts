import { issueInternalToken, userDoName } from "protocol";
import { eq } from "drizzle-orm";
import { getDb } from "@worker/db/client";
import { users } from "@worker/db/schema-d1";
import { verifyAuthJwt } from "@worker/jwks";

export async function handleWsUpgrade(request: Request, env: Env): Promise<Response> {
  // Browsers cannot set custom headers on WebSocket, so the bearer token is
  // accepted from the query string as well (see platform §4.2 in the spec).
  const authHeader = request.headers.get("authorization") ?? "";
  const url = new URL(request.url);
  const token =
    (authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null) ??
    url.searchParams.get("token");
  if (!token) {
    return new Response("missing token", { status: 401 });
  }

  const claims = await verifyAuthJwt(token, env);
  if (!claims) {
    return new Response("invalid token", { status: 401 });
  }

  const db = getDb(env.DB);
  const rows = await db
    .select({ banned: users.banned })
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);
  const row = rows[0];
  if (row?.banned) {
    return new Response("banned", { status: 403 });
  }

  const internal = await issueInternalToken({
    subject: `user:${claims.sub}`,
    secret: env.INTERNAL_TOKEN_KEY,
  });
  const upgraded = new Request(request);
  upgraded.headers.set("x-internal-token", internal);
  upgraded.headers.delete("authorization");

  const id = env.USER_DO.idFromName(userDoName(claims.sub));
  return env.USER_DO.get(id).fetch(
    new Request(
      `http://user-do/ws?deviceId=${url.searchParams.get("deviceId") ?? "unknown"}&platform=${url.searchParams.get("platform") ?? "web"}&sub=${claims.sub}`,
      {
        headers: upgraded.headers,
      },
    ),
  );
}
