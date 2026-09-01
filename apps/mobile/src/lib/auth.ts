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
}

/** Bearer-token REST client for the v1 API. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await tokenStore.get();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (res.status === 401) {
    await tokenStore.clear();
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} failed (${res.status})`);
  return (await res.json()) as T;
}
