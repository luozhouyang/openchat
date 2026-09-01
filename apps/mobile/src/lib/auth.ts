import { ApiError, createApiFetch } from "protocol";
import { API_URL } from "./config";
import { tokenStore } from "./secure";

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
}

interface AuthResponse {
  token?: string;
  user?: SessionUser;
  error?: { message?: string } | null;
}

async function authCall(path: string, body: unknown): Promise<AuthResponse> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as AuthResponse;
  if (!res.ok) {
    throw new Error(json.error?.message ?? `auth request failed (${res.status})`);
  }
  return json;
}

export async function signUp(email: string, password: string): Promise<void> {
  const res = await authCall("/api/auth/sign-up/email", {
    email,
    password,
    name: email.split("@")[0],
  });
  if (!res.token) throw new Error("sign-up did not return a token");
  await tokenStore.set(res.token);
}

export async function signIn(email: string, password: string): Promise<void> {
  const res = await authCall("/api/auth/sign-in/email", { email, password });
  if (!res.token) throw new Error("sign-in did not return a token");
  await tokenStore.set(res.token);
}

export async function signOut(): Promise<void> {
  await tokenStore.clear();
  wsJwt = null;
}

// Shared protocol fetcher with bearer injection (one REST client story for
// all three apps — web uses the cookie default).
const fetchWithToken = createApiFetch({ baseUrl: API_URL, getToken: () => tokenStore.get() });

/**
 * JWT for the WebSocket upgrade. The WS route (apps/api routes/ws.ts)
 * verifies a short-lived better-auth JWT via JWKS — the stored session token
 * (bearer plugin) is NOT accepted there, so the WS token must come from
 * POST /api/auth/token. Cached in memory; RealtimeClient re-fetches on every
 * connect, which also covers expiry (15 min JWT, 10 min cache).
 */
let wsJwt: { session: string; token: string; fetchedAt: number } | null = null;

export async function getWsJwt(): Promise<string | null> {
  const session = await tokenStore.get();
  if (!session) return null;
  if (wsJwt && wsJwt.session === session && Date.now() - wsJwt.fetchedAt < 10 * 60_000) {
    return wsJwt.token;
  }
  try {
    const res = await fetch(`${API_URL}/api/auth/token`, {
      headers: { authorization: `Bearer ${session}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: string };
    if (!body.token) return null;
    wsJwt = { session, token: body.token, fetchedAt: Date.now() };
    return body.token;
  } catch {
    return null;
  }
}

/** Bearer-token REST client for the v1 API. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await fetchWithToken<T>(path, init);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await tokenStore.clear();
      throw new Error("unauthorized");
    }
    if (e instanceof ApiError) {
      throw new Error(`${init?.method ?? "GET"} ${path} failed (${e.status})`);
    }
    throw e;
  }
}
