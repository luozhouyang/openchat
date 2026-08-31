import { issueInternalToken, userDoName } from "protocol";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { users } from "../db/schema-d1.ts";
import { verifyAuthJwt } from "../jwks.ts";

export async function handleWsUpgrade(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return new Response("missing token", { status: 401 });

  const claims = await verifyAuthJwt(token, env);
  if (!claims) return new Response("invalid token", { status: 401 });

  const db = getDb(env.DB);
  const rows = await db
    .select({ banned: users.banned })
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);
  if (rows[0]?.banned) return new Response("banned", { status: 403 });

  const url = new URL(request.url);
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
