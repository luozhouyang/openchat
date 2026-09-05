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

  // Same-origin modes ("" in the browser, "app://-" behind the shell's /api
  // proxy): better-auth validates its baseURL as http(s) and falls back to
  // window.location.origin (which is NOT http on app://), so we pass a
  // placeholder base and rewrite every request to a same-origin relative
  // URL inside our custom fetch.
  const sameOrigin = !/^https?:\/\//.test(deps.apiBaseUrl);
  const authClient = createAuthClient({
    baseURL: sameOrigin ? "http://openchat.invalid" : deps.apiBaseUrl,
    plugins: [jwtClient()],
    fetchOptions: {
      customFetchImpl: async (request, init) => {
        const headers = new Headers(init?.headers);
        if (!cookieMode) {
          const session = await deps.getSessionToken();
          if (session) {
            headers.set("authorization", `Bearer ${session}`);
          }
        }
        // Same-origin mode rewrites the absolute placeholder URL to a
        // relative path (served by the app:// /api proxy or the browser's
        // own origin); otherwise fetch the absolute URL unchanged.
        const href =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.href
              : request.url;
        const target = sameOrigin ? `${new URL(href).pathname}${new URL(href).search}` : href;
        return fetch(target, { ...init, headers, credentials: cookieMode ? "include" : "omit" });
      },
    },
  });

  async function persistBearerToken(data: unknown): Promise<void> {
    // The server-side bearer plugin puts the session token in the response
    // body; the client type does not know about it.
    const token = (data as { token?: string } | null | undefined)?.token;
    if (!token) {
      throw new Error("auth response did not carry a bearer token");
    }
    await deps.setSessionToken?.(token);
    wsJwt = null;
  }

  return {
    async signIn(email, password) {
      const res = await authClient.signIn.email({ email, password });
      if (res.error) {
        throw new Error(res.error.message ?? "sign-in failed");
      }
      if (!cookieMode) {
        await persistBearerToken(res.data);
      }
    },

    async signUp(email, password) {
      const res = await authClient.signUp.email({
        email,
        password,
        name: email.split("@")[0],
      });
      if (res.error) {
        throw new Error(res.error.message ?? "sign-up failed");
      }
      if (!cookieMode) {
        await persistBearerToken(res.data);
      }
    },

    async signOut() {
      try {
        await authClient.signOut();
      } catch {
        // best effort — local state is cleared regardless
      }
      if (!cookieMode) {
        await deps.setSessionToken?.(null);
      }
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
        try {
          const { data } = await authClient.token();
          return data?.token ?? null;
        } catch {
          return null;
        }
      }
      const session = await deps.getSessionToken();
      if (!session) {
        return null;
      }
      if (wsJwt && wsJwt.session === session && Date.now() - wsJwt.fetchedAt < WS_JWT_TTL_MS) {
        return wsJwt.token;
      }
      try {
        const { data } = await authClient.token();
        if (!data?.token) {
          return null;
        }
        wsJwt = { session, token: data.token, fetchedAt: Date.now() };
        return data.token;
      } catch {
        return null;
      }
    },
  };
}
