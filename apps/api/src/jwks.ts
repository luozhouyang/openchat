import * as jose from "jose";
import { makeAuth } from "./auth.ts";

let cachedKeys: jose.JSONWebKeySet | null = null;

async function fetchJwks(env: Env): Promise<jose.JSONWebKeySet> {
  const auth = makeAuth(env);
  const res = await auth.handler(new Request(new URL("/api/auth/jwks", env.BETTER_AUTH_URL)));
  if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`);
  return (await res.json()) as jose.JSONWebKeySet;
}

async function getKeySet(env: Env, force: boolean): Promise<jose.JSONWebKeySet> {
  if (!cachedKeys || force) cachedKeys = await fetchJwks(env);
  return cachedKeys;
}

export async function verifyAuthJwt(
  token: string,
  env: Env,
): Promise<{ sub: string; email?: string; name?: string } | null> {
  let decode: jose.ProtectedHeaderParameters;
  try {
    decode = jose.decodeProtectedHeader(token);
  } catch {
    return null;
  }
  for (const attempt of [false, true]) {
    const keys = await getKeySet(env, attempt);
    if (decode.kid && !keys.keys.some((k) => k.kid === decode.kid)) {
      if (!attempt) continue;
      return null;
    }
    try {
      const { payload } = await jose.jwtVerify(token, jose.createLocalJWKSet(keys), {
        issuer: env.BETTER_AUTH_URL,
        audience: env.BETTER_AUTH_URL,
      });
      if (typeof payload.sub !== "string") return null;
      return {
        sub: payload.sub,
        email: typeof payload.email === "string" ? payload.email : undefined,
        name: typeof payload.name === "string" ? payload.name : undefined,
      };
    } catch {
      if (!attempt) continue;
      return null;
    }
  }
  return null;
}
