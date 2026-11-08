import { issueInternalToken, userDoName } from "protocol";
import { eq } from "drizzle-orm";
import { makeAuth } from "@worker/auth";
import { getDb } from "@worker/db/client";
import { users } from "@worker/db/schema-d1";
import { verifyAuthJwt } from "@worker/jwks";

export async function handleWsUpgrade(request: Request, env: Env): Promise<Response> {
  // Browsers cannot set custom headers on WebSocket, so the bearer token is
  // accepted from the query string as well (see platform §4.2 in the spec).
  // A same-origin session cookie is preferred and needs no token at all.
  const authHeader = request.headers.get("authorization") ?? "";
  const url = new URL(request.url);
  const token =
    (authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null) ??
    url.searchParams.get("token");
  let userId: string;
  if (token) {
    const claims = await verifyAuthJwt(token, env);
    if (!claims) {
      return new Response("invalid token", { status: 401 });
    }
    userId = claims.sub;
  } else {
    const session = await makeAuth(env).api.getSession({ headers: request.headers });
    if (!session?.user?.id) {
      return new Response("missing token", { status: 401 });
    }
    userId = session.user.id;
  }

  const db = getDb(env.DB);
  const rows = await db
    .select({ banned: users.banned })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (row?.banned) {
    return new Response("banned", { status: 403 });
  }

  const internal = await issueInternalToken({
    subject: `user:${userId}`,
    secret: env.INTERNAL_TOKEN_KEY,
  });
  const upgraded = new Request(request);
  upgraded.headers.set("x-internal-token", internal);
  upgraded.headers.delete("authorization");

  const id = env.USER_DO.idFromName(userDoName(userId));
  return env.USER_DO.get(id).fetch(
    new Request(
      `http://user-do/ws?deviceId=${url.searchParams.get("deviceId") ?? "unknown"}&platform=${url.searchParams.get("platform") ?? "web"}&sub=${userId}`,
      {
        headers: upgraded.headers,
      },
    ),
  );
}
