/**
 * Shared authentication flows for every client (P12-C). One implementation
 * of the WS-JWT exchange with its session-keyed cache — previously written
 * twice (mobile lib/auth and web desktop-mode).
 *
 * Modes (derived from apiBaseUrl):
 *  - ""          cookie mode (browser): requests are same-origin with
 *                credentials; sign-in relies on the better-auth cookie.
 *  - "<origin>"  bearer mode (mobile, Electron file://): Authorization from
 *                getSessionToken(), credentials omitted so anonymous CORS
 *                responses are accepted.
 */
export interface AuthServiceDeps {
  apiBaseUrl: string;
  getSessionToken(): Promise<string | null>;
  /** Persists the session token (SecureStore / desktop bridge). Cookie mode omits it. */
  setSessionToken?(token: string | null): Promise<void>;
}

export interface AuthService {
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  hasSession(): Promise<boolean>;
  /** Short-lived better-auth JWT for the WebSocket upgrade (GET /api/auth/token). */
  getWsJwt(): Promise<string | null>;
}

interface AuthResponseBody {
  token?: string;
  error?: { message?: string } | null;
}

const WS_JWT_TTL_MS = 10 * 60_000; // JWT lives 15min; rotate a bit early

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const cookieMode = deps.apiBaseUrl === "";
  let wsJwt: { session: string; token: string; fetchedAt: number } | null = null;

  async function authFetch(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    if (!cookieMode) {
      const session = await deps.getSessionToken();
      if (session) headers.set("authorization", `Bearer ${session}`);
    }
    return fetch(`${deps.apiBaseUrl}${path}`, {
      ...init,
      headers,
      credentials: cookieMode ? "include" : "omit",
    });
  }

  async function postCredentials(
    path: string,
    body: Record<string, string>,
  ): Promise<AuthResponseBody> {
    const res = await authFetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => ({}))) as AuthResponseBody;
    if (!res.ok) {
      throw new Error(parsed.error?.message ?? `auth request failed (${res.status})`);
    }
    return parsed;
  }

  return {
    async signIn(email, password) {
      const body = await postCredentials("/api/auth/sign-in/email", { email, password });
      if (!cookieMode) {
        if (!body.token) throw new Error("sign-in did not return a token");
        await deps.setSessionToken?.(body.token);
        wsJwt = null;
      }
    },

    async signUp(email, password) {
      const body = await postCredentials("/api/auth/sign-up/email", {
        email,
        password,
        name: email.split("@")[0],
      });
      if (!cookieMode) {
        if (!body.token) throw new Error("sign-up did not return a token");
        await deps.setSessionToken?.(body.token);
        wsJwt = null;
      }
    },

    async signOut() {
      try {
        await authFetch("/api/auth/sign-out", { method: "POST" });
      } catch {
        // best effort — local state is cleared regardless
      }
      if (!cookieMode) await deps.setSessionToken?.(null);
      wsJwt = null;
    },

    async hasSession() {
      try {
        const res = await authFetch("/api/v1/users/me");
        return res.ok;
      } catch {
        return false;
      }
    },

    async getWsJwt() {
      if (cookieMode) {
        try {
          const res = await fetch(`${deps.apiBaseUrl}/api/auth/token`, {
            credentials: "include",
          });
          if (!res.ok) return null;
          return ((await res.json()) as { token?: string }).token ?? null;
        } catch {
          return null;
        }
      }
      const session = await deps.getSessionToken();
      if (!session) return null;
      if (wsJwt && wsJwt.session === session && Date.now() - wsJwt.fetchedAt < WS_JWT_TTL_MS) {
        return wsJwt.token;
      }
      try {
        const res = await fetch(`${deps.apiBaseUrl}/api/auth/token`, {
          headers: { authorization: `Bearer ${session}` },
          credentials: "omit",
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { token?: string };
        if (!body.token) return null;
        wsJwt = { session, token: body.token, fetchedAt: Date.now() };
        return body.token;
      } catch {
        return null;
      }
    },
  };
}
