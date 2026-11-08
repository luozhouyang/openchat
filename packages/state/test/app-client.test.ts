import { beforeEach, expect, test, vi } from "vite-plus/test";
import type { Message } from "protocol";
import { createMemoryDatabase, type LocalDatabase } from "../src/db/database.ts";
import { createAppClient, type AppClientPlatform } from "../src/app.ts";
import { createAuthService } from "../src/services/auth.ts";
import { createChannelsService } from "../src/services/channels.ts";
import { createMessagesService } from "../src/services/messages.ts";
import { useMessageStore } from "../src/stores/messages.ts";

function fakePlatform(overrides: Partial<AppClientPlatform> = {}): AppClientPlatform {
  return {
    apiBaseUrl: "http://api.test",
    wsUrl: "ws://api.test/ws",
    getSessionToken: vi.fn(async () => "session-1"),
    setSessionToken: vi.fn(async () => {}),
    openLocalDatabase: async () => createMemoryDatabase(),
    ...overrides,
  };
}

const msg = (seq: number, id = `m${seq}`): Message => ({
  id,
  seq,
  userId: "u1",
  parentId: null,
  type: "text",
  content: `c${seq}`,
  attachments: null,
  mentions: null,
  editedAt: null,
  deletedAt: null,
  createdAt: seq,
});

beforeEach(() => {
  useMessageStore.setState({ channels: {}, threads: {} });
});

test("auth service (bearer mode): sign-in stores the token, WS JWT cached per session", async () => {
  const setSessionToken = vi.fn(async () => {});
  const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
  globalThis.fetch = fetchMock as typeof globalThis.fetch;
  const svc = createAuthService({
    apiBaseUrl: "http://api.test",
    getSessionToken: async () => "session-1",
    setSessionToken,
  });

  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ token: "session-1" }), { status: 200 }),
  );
  await svc.signIn("a@b.c", "pw");
  expect(setSessionToken).toHaveBeenCalledWith("session-1");
  const signIn = fetchMock.mock.calls[0];
  expect(String(signIn?.[0])).toContain("/api/auth/sign-in/email");
  const signInHeaders = signIn?.[1]?.headers;
  const signInAuth =
    signInHeaders instanceof Headers
      ? signInHeaders.get("authorization")
      : (signInHeaders as Record<string, string> | undefined)?.authorization;
  // The mode fetch injects any stored session on every call — harmless on
  // credential endpoints (server logs in with the submitted credentials).
  expect(signInAuth).toBe("Bearer session-1");

  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ token: "jwt-1" }), { status: 200 }),
  );
  await expect(svc.getWsJwt()).resolves.toBe("jwt-1");
  const jwtCall = fetchMock.mock.calls[1];
  expect(String(jwtCall?.[0])).toContain("/api/auth/token");
  const jwtHeaders = jwtCall?.[1]?.headers;
  const jwtAuth =
    jwtHeaders instanceof Headers
      ? jwtHeaders.get("authorization")
      : (jwtHeaders as Record<string, string> | undefined)?.authorization;
  expect(jwtAuth).toBe("Bearer session-1");
  expect(jwtCall?.[1]?.credentials).toBe("omit");

  // Cached within the TTL — no extra fetch.
  await expect(svc.getWsJwt()).resolves.toBe("jwt-1");
  expect(fetchMock).toHaveBeenCalledTimes(2);

  // A different session invalidates the cache.
  const svc2 = createAuthService({
    apiBaseUrl: "http://api.test",
    getSessionToken: async () => "session-2",
  });
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ token: "jwt-2" }), { status: 200 }),
  );
  await expect(svc2.getWsJwt()).resolves.toBe("jwt-2");
});

test("auth service (cookie mode): credentials included, no bearer header", async () => {
  const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
  globalThis.fetch = fetchMock as typeof globalThis.fetch;
  const svc = createAuthService({ apiBaseUrl: "", getSessionToken: async () => null });

  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ token: "jwt-web" }), { status: 200 }),
  );
  await expect(svc.getWsJwt()).resolves.toBe("jwt-web");
  expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("include");
});

test("auth service: hasSession probes /users/me and maps failures", async () => {
  const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
  globalThis.fetch = fetchMock as typeof globalThis.fetch;
  const svc = createAuthService({
    apiBaseUrl: "http://api.test",
    getSessionToken: async () => "session-1",
  });
  fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
  await expect(svc.hasSession()).resolves.toBe(false);
  fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
  await expect(svc.hasSession()).resolves.toBe(true);
  fetchMock.mockRejectedValueOnce(new TypeError("offline"));
  await expect(svc.hasSession()).resolves.toBe(false);
});

test("messages service: optimistic send lands acked, failure restores", async () => {
  const db = createMemoryDatabase();
  const createPost = vi.fn(async () => ({ id: "real-1", seq: 1 }));
  const svc = createMessagesService({ getDb: async () => db, createPost });
  await expect(svc.send("c1", "hello", "tok-1")).resolves.toBe(true);
  const list = useMessageStore.getState().list("c1");
  expect(list.map((m) => m.id)).toEqual(["real-1"]);
  expect(await db.messages.maxSeq("c1")).toBe(1); // persisted

  createPost.mockRejectedValueOnce(new Error("offline"));
  await expect(svc.send("c1", "again", "tok-2")).resolves.toBe(false);
  expect(
    useMessageStore
      .getState()
      .list("c1")
      .map((m) => m.id),
  ).toEqual(["real-1"]);
});

test("channels service: hydrate from db, applyHistory persists, loadOlder pages back", async () => {
  const db = createMemoryDatabase();
  await db.messages.append("c1", msg(5));
  // Server has 1..7; local head is 5.
  const pages = new Map<number | undefined, Message[]>();
  pages.set(undefined, [msg(7), msg(6)]);
  pages.set(5, [msg(4), msg(3), msg(2)]);
  const fetchHistory = vi.fn(async (_c: string, beforeSeq?: number) => pages.get(beforeSeq) ?? []);
  const svc = createChannelsService({ getDb: async () => db, fetchHistory, pageSize: 3 });

  expect(await svc.hydrate("c1")).toBe(1);
  await svc.applyHistory("c1", [msg(7), msg(6)]);
  expect(await db.messages.maxSeq("c1")).toBe(7);

  expect(await svc.loadOlder("c1")).toBe(true); // full page → maybe more
  expect(await db.messages.maxSeq("c1")).toBe(7);
  expect(fetchHistory).toHaveBeenCalledWith("c1", 5);
});

test("app client: bearer mode REST carries the session token; cookie mode stays relative", async () => {
  const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
  globalThis.fetch = fetchMock as typeof globalThis.fetch;
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify({ teams: [] }), { status: 200 }),
  );

  const bearer = createAppClient({ platform: fakePlatform() });
  await bearer.api.workspaces();
  let call = fetchMock.mock.calls[0];
  expect(String(call?.[0])).toBe("http://api.test/api/v1/users/me/workspaces");
  const bearerHeaders = call?.[1]?.headers;
  const auth =
    bearerHeaders instanceof Headers
      ? bearerHeaders.get("authorization")
      : (bearerHeaders as Record<string, string> | undefined)?.authorization;
  expect(auth).toBe("Bearer session-1");
  expect(call?.[1]?.credentials).toBe("omit");

  fetchMock.mockClear();
  const cookie = createAppClient({
    platform: fakePlatform({ apiBaseUrl: "", wsUrl: "ws://x/ws" }),
  });
  await cookie.api.workspaces();
  call = fetchMock.mock.calls[0];
  expect(String(call?.[0])).toBe("/api/v1/users/me/workspaces");
  expect(call?.[1]?.credentials).toBe("include");
});

test("channels service: hydrate reads the DB isPinned flag through to the store", async () => {
  const db = createMemoryDatabase();
  await db.messages.append("c1", { ...msg(1), isPinned: true });
  await db.messages.append("c1", msg(2));
  const svc = createChannelsService({ getDb: async () => db, fetchHistory: vi.fn() });
  await svc.hydrate("c1");
  const list = useMessageStore.getState().list("c1");
  expect(list.map((m) => m.isPinned)).toEqual([true, false]);
});

test("app client: createRealtime wires sync + dispatch through shared pipeline", async () => {
  const db: LocalDatabase = createMemoryDatabase();
  await db.messages.append("c1", msg(3));
  const client = createAppClient({
    platform: fakePlatform({ openLocalDatabase: async () => db }),
  });
  const onMessageNew = vi.fn();
  const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
  globalThis.fetch = fetchMock as typeof globalThis.fetch;

  const conn = client.createRealtime({ onMessageNew });
  conn.dispatch(
    JSON.stringify({
      type: "channel.event",
      channelId: "c1",
      event: { type: "message.new", message: msg(4) },
    }),
  );
  expect(onMessageNew).toHaveBeenCalledWith("c1", msg(4));
  await vi.waitFor(async () => expect(await db.messages.maxSeq("c1")).toBe(4));
  expect(typeof conn.send).toBe("function");
  expect(typeof conn.sendActivity).toBe("function");
});

test("app client: createRealtime surfaces error frames through the onLocal hook", () => {
  const client = createAppClient({ platform: fakePlatform() });
  const onLocal = vi.fn();
  const conn = client.createRealtime({ onLocal });
  // react-path error frame with attribution (P1-3): dispatcher fails any
  // pending message and the app hook receives the verbatim event.
  useMessageStore.getState().appendPending("c1", "tok", { ...msg(0), id: "pending-tok" });
  conn.dispatch(
    JSON.stringify({
      type: "error",
      code: "http_429",
      message: "slow down",
      channelId: "c1",
      clientToken: "tok",
    }),
  );
  expect(useMessageStore.getState().list("c1")).toHaveLength(0); // pending rolled back
  expect(onLocal).toHaveBeenCalledTimes(1);
  expect(onLocal).toHaveBeenCalledWith(
    expect.objectContaining({ type: "error", clientToken: "tok", code: "http_429" }),
  );
});
