/**
 * Desktop file:// mode (p10 spec §6.2). When the web renderer runs from the
 * Electron shell's packaged files there are no cookies and no http origin:
 * auth goes through the safeStorage-backed bearer token exposed by the
 * preload bridge, and every REST/WS call targets the injected API origin.
 * In a plain browser every helper here is inert.
 */
import { desktopBridge } from "./desktop-bridge";

export const desktopFileMode: boolean =
  typeof window !== "undefined" &&
  window.location.protocol === "file:" &&
  !!desktopBridge &&
  desktopBridge.serverUrl.length > 0;

/** Bearer session token from the safeStorage store (null outside the shell). */
export function getDesktopToken(): Promise<string | null> {
  return desktopFileMode ? desktopBridge!.getToken() : Promise.resolve(null);
}

/** API origin injected by the Electron main process ("" in the browser). */
export const desktopServerUrl: string = desktopFileMode ? desktopBridge!.serverUrl : "";

interface AuthResponse {
  token?: string;
  error?: { message?: string } | null;
}

/** better-auth email sign-in over bearer (the web cookie flow needs an origin). */
export async function signInDesktop(email: string, password: string): Promise<void> {
  const res = await fetch(`${desktopServerUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json().catch(() => ({}))) as AuthResponse;
  if (!res.ok || !body.token) {
    throw new Error(body.error?.message ?? `sign-in failed (${res.status})`);
  }
  await desktopBridge!.setToken(body.token);
}

export async function signOutDesktop(): Promise<void> {
  await desktopBridge!.clearToken();
}

/** Session probe for the root route guard (replaces authClient.getSession). */
export async function hasDesktopSession(): Promise<boolean> {
  const token = await desktopBridge!.getToken();
  if (!token) return false;
  try {
    const res = await fetch(`${desktopServerUrl}/api/v1/users/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

// The WS upgrade verifies a short-lived better-auth JWT (not the session
// token) — same rule as the mobile client (apps/mobile lib/auth.ts getWsJwt).
let wsJwt: { session: string; token: string; fetchedAt: number } | null = null;

export async function getDesktopWsJwt(): Promise<string | null> {
  const bridge = desktopBridge!;
  const session = await bridge.getToken();
  if (!session) return null;
  if (wsJwt && wsJwt.session === session && Date.now() - wsJwt.fetchedAt < 10 * 60_000) {
    return wsJwt.token;
  }
  try {
    const res = await fetch(`${desktopServerUrl}/api/auth/token`, {
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
