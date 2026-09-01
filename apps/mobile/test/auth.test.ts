import { beforeEach, expect, jest, test } from "@jest/globals";
import { api, signIn, signOut, signUp } from "../src/lib/auth";
import { tokenStore } from "../src/lib/secure";

const mockFetch = jest.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
globalThis.fetch = mockFetch as typeof globalThis.fetch;

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    __clear: () => store.clear(),
    getItemAsync: async (k: string) => store.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void store.set(k, v),
    deleteItemAsync: async (k: string) => void store.delete(k),
  };
});

beforeEach(() => {
  mockFetch.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (jest.requireMock("expo-secure-store") as { __clear: () => void }).__clear();
});

test("signIn persists the bearer token from better-auth", async () => {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ token: "tok-1", user: { id: "u1" } }), { status: 200 }),
  );
  await signIn("a@b.c", "pw");
  expect(await tokenStore.get()).toBe("tok-1");
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining("/api/auth/sign-in/email"),
    expect.objectContaining({ method: "POST" }),
  );
});

test("api attaches Authorization header and clears token on 401", async () => {
  await tokenStore.set("tok-1");
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ teams: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  mockFetch.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));

  const res = await api<{ teams: unknown[] }>("/api/v1/users/me/workspaces");
  expect(res).toEqual({ teams: [] });
  const sentHeaders = (mockFetch.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
  expect(sentHeaders.authorization).toBe("Bearer tok-1");

  await expect(api("/api/v1/users/me/workspaces")).rejects.toThrow("unauthorized");
  expect(await tokenStore.get()).toBeNull();
});

test("signUp fails loudly when the server returns no token", async () => {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200 }),
  );
  await expect(signUp("a@b.c", "pw")).rejects.toThrow("token");
  expect(await tokenStore.get()).toBeNull();
});

test("signOut clears the stored token", async () => {
  await tokenStore.set("tok-1");
  await signOut();
  expect(await tokenStore.get()).toBeNull();
});
