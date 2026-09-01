import { createAuthClient } from "better-auth/client";
import { jwtClient } from "better-auth/client/plugins";

/**
 * Shared authentication flows for every client (P12-C), implemented on the
 * official better-auth client (vanilla, framework-free). Endpoint
 * construction, error normalization and the WS-JWT endpoint all come from
 * the library; only the dual mode is ours:
 *  - ""          cookie mode (browser): same-origin, credentials included.
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
  /** Short-lived better-auth JWT for the WebSocket upgrade. */
  getWsJwt(): Promise<string | null>;
}

const WS_JWT_TTL_MS = 10 * 60_000; // JWT lives 15min; rotate a bit early

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const cookieMode = deps.apiBaseUrl === "";
  let wsJwt: { session: string; token: string; fetchedAt: number } | null = null;

  const authClient = createAuthClient({
    baseURL: deps.apiBaseUrl || undefined,
    plugins: [jwtClient()],
    fetchOptions: {
      customFetchImpl: async (url, init) => {
        const headers = new Headers(init?.headers);
        if (!cookieMode) {
          const session = await deps.getSessionToken();
          if (session) headers.set("authorization", `Bearer ${session}`);
        }
        return fetch(url, { ...init, headers, credentials: cookieMode ? "include" : "omit" });
      },
    },
  });

  async function persistBearerToken(data: unknown): Promise<void> {
    // The server-side bearer plugin puts the session token in the response
    // body; the client type does not know about it.
    const token = (data as { token?: string } | null | undefined)?.token;
    if (!token) throw new Error("auth response did not carry a bearer token");
    await deps.setSessionToken?.(token);
    wsJwt = null;
  }

  return {
    async signIn(email, password) {
      const res = await authClient.signIn.email({ email, password });
      if (res.error) throw new Error(res.error.message ?? "sign-in failed");
      if (!cookieMode) await persistBearerToken(res.data);
    },

    async signUp(email, password) {
      const res = await authClient.signUp.email({
        email,
        password,
        name: email.split("@")[0],
      });
      if (res.error) throw new Error(res.error.message ?? "sign-up failed");
      if (!cookieMode) await persistBearerToken(res.data);
    },

    async signOut() {
      try {
        await authClient.signOut();
      } catch {
        // best effort — local state is cleared regardless
      }
      if (!cookieMode) await deps.setSessionToken?.(null);
      wsJwt = null;
    },

    async hasSession() {
      try {
        const { data } = await authClient.getSession();
        return !!data;
      } catch {
        return false;
      }
    },

    async getWsJwt() {
      if (cookieMode) {
        const { data } = await authClient.token();
        return data?.token ?? null;
      }
      const session = await deps.getSessionToken();
      if (!session) return null;
      if (wsJwt && wsJwt.session === session && Date.now() - wsJwt.fetchedAt < WS_JWT_TTL_MS) {
        return wsJwt.token;
      }
      try {
        const { data } = await authClient.token();
        if (!data?.token) return null;
        wsJwt = { session, token: data.token, fetchedAt: Date.now() };
        return data.token;
      } catch {
        return null;
      }
    },
  };
}
