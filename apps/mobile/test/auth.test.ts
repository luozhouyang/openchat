import { beforeEach, expect, jest, test } from "@jest/globals";
import { appClient } from "../src/app-client";
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
  (jest.requireMock("expo-secure-store") as { __clear: () => void }).__clear();
});

test("shared auth service sign-in persists the bearer token (SecureStore)", async () => {
  mockFetch.mockImplementation(
    async () =>
      new Response(JSON.stringify({ token: "tok-1", user: { id: "u1" } }), { status: 200 }),
  );
  await appClient.auth.signIn("a@b.c", "pw");
  expect(await tokenStore.get()).toBe("tok-1");
  const call = mockFetch.mock.calls[0];
  expect(String(call[0])).toContain("/api/auth/sign-in/email");
});

test("sign-out clears the stored token", async () => {
  await tokenStore.set("tok-1");
  mockFetch.mockImplementation(async () => new Response("{}", { status: 200 }));
  await appClient.auth.signOut();
  expect(await tokenStore.get()).toBeNull();
});

test("hasSession maps a 401 to false without throwing", async () => {
  await tokenStore.set("tok-1");
  mockFetch.mockImplementation(async () => new Response("unauthorized", { status: 401 }));
  await expect(appClient.auth.hasSession()).resolves.toBe(false);
});
