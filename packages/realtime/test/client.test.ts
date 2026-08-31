import { expect, test, vi } from "vite-plus/test";
import { RealtimeClient } from "../src/client.ts";
import type { WebSocketLike } from "../src/types.ts";

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close(_code?: number, _reason?: string) {
    this.readyState = 3;
    this.onclose?.();
  }
}

type ClientOpts = ConstructorParameters<typeof RealtimeClient>[0];

function make(opts: Partial<ClientOpts> = {}) {
  const handlers = {
    onOpen: vi.fn(),
    onMessage: vi.fn(),
    onStateChange: vi.fn(),
    onAuthMissing: vi.fn(),
    ...opts.handlers,
  };
  const sockets: FakeSocket[] = [];
  const client = new RealtimeClient({
    getToken: vi.fn(async () => "tok-1"),
    buildUrl: (deviceId, token) => `/ws?deviceId=${deviceId}&token=${token}`,
    onAuthMissing: handlers.onAuthMissing,
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    handlers,
    ...opts,
  });
  return { client, handlers, sockets };
}

test("connect builds URL, transitions to open on open", async () => {
  const { client, handlers, sockets } = make();
  await client.connect("dev-1");
  expect(sockets[0].readyState).toBe(0);
  expect(handlers.onStateChange).toHaveBeenLastCalledWith("connecting");
  sockets[0].readyState = 1;
  sockets[0].onopen?.();
  expect(handlers.onStateChange).toHaveBeenLastCalledWith("open");
  expect(handlers.onOpen).toHaveBeenCalledOnce();
});

test("onmessage forwards raw string payload", async () => {
  const { client, handlers, sockets } = make();
  await client.connect("dev-1");
  sockets[0].onmessage?.({ data: JSON.stringify({ type: "hello" }) });
  expect(handlers.onMessage).toHaveBeenCalledWith('{"type":"hello"}');
});

test("auth missing triggers onAuthMissing and never opens socket", async () => {
  const { client, handlers, sockets } = make({ getToken: vi.fn(async () => null) });
  await client.connect("dev-1");
  expect(handlers.onAuthMissing).toHaveBeenCalledOnce();
  expect(sockets).toHaveLength(0);
});

test("close without user intent schedules reconnect with backoff cap", async () => {
  vi.useFakeTimers();
  const { client, handlers, sockets } = make();
  await client.connect("dev-1");
  sockets[0].onclose?.();
  expect(handlers.onStateChange).toHaveBeenLastCalledWith("reconnecting");
  await vi.advanceTimersByTimeAsync(1501);
  expect(sockets).toHaveLength(2);
  vi.useRealTimers();
});

test("send is ignored when not open", async () => {
  const { client, sockets } = make();
  await client.connect("dev-1");
  const ok = client.send("x");
  expect(ok).toBe(false);
  expect(sockets[0].sent).toHaveLength(0);
});

test("send works when open", async () => {
  const { client, sockets } = make();
  await client.connect("dev-1");
  sockets[0].readyState = 1;
  const ok = client.send("x");
  expect(ok).toBe(true);
  expect(sockets[0].sent).toEqual(["x"]);
});

test("user close() transitions to idle and does not reconnect", async () => {
  vi.useFakeTimers();
  const { client, handlers, sockets } = make();
  await client.connect("dev-1");
  sockets[0].readyState = 1;
  client.close();
  expect(handlers.onStateChange).toHaveBeenLastCalledWith("idle");
  await vi.advanceTimersByTimeAsync(5000);
  expect(sockets).toHaveLength(1);
  vi.useRealTimers();
});

test("token refresh closes socket with 4100 after tokenTtlMs", async () => {
  vi.useFakeTimers();
  const { client, sockets } = make({ tokenTtlMs: 60_000 });
  await client.connect("dev-1");
  sockets[0].readyState = 1;
  const closeSpy = vi.spyOn(sockets[0], "close");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(closeSpy).toHaveBeenCalledWith(4100, "token-refresh");
  vi.useRealTimers();
});

test("backoff grows and caps at reconnectMaxMs", async () => {
  vi.useFakeTimers();
  const { client, sockets } = make({ reconnectBaseMs: 1000, reconnectMaxMs: 4000 });
  await client.connect("dev-1");
  // close → reconnect at ~1s
  sockets[0].onclose?.();
  await vi.advanceTimersByTimeAsync(1501);
  expect(sockets).toHaveLength(2);
  // close → reconnect at ~2s
  sockets[1].onclose?.();
  await vi.advanceTimersByTimeAsync(2501);
  expect(sockets).toHaveLength(3);
  // close → reconnect at ~4s (capped)
  sockets[2].onclose?.();
  await vi.advanceTimersByTimeAsync(4501);
  expect(sockets).toHaveLength(4);
  vi.useRealTimers();
});

test("buildUrl receives token and deviceId", async () => {
  const buildUrl = vi.fn((deviceId, token) => `/ws?deviceId=${deviceId}&token=${token}`);
  const sockets: FakeSocket[] = [];
  const client = new RealtimeClient({
    getToken: vi.fn(async () => "tok-1"),
    buildUrl,
    onAuthMissing: vi.fn(),
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    handlers: { onOpen: vi.fn(), onMessage: vi.fn(), onStateChange: vi.fn() },
  });
  await client.connect("dev-1");
  expect(buildUrl).toHaveBeenCalledWith("dev-1", "tok-1");
});

test("non-string message payload is ignored", async () => {
  const { client, handlers, sockets } = make();
  await client.connect("dev-1");
  sockets[0].onmessage?.({ data: new Uint8Array([1, 2]) });
  expect(handlers.onMessage).not.toHaveBeenCalled();
});

test("reconnect after unexpected close refetches token", async () => {
  vi.useFakeTimers();
  const getToken = vi.fn(async () => "tok-1");
  const sockets: FakeSocket[] = [];
  const client = new RealtimeClient({
    getToken,
    buildUrl: (deviceId, token) => `/ws?deviceId=${deviceId}&token=${token}`,
    onAuthMissing: vi.fn(),
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    handlers: { onOpen: vi.fn(), onMessage: vi.fn(), onStateChange: vi.fn() },
  });
  await client.connect("dev-1");
  expect(getToken).toHaveBeenCalledTimes(1);
  sockets[0].onclose?.();
  await vi.advanceTimersByTimeAsync(1501);
  expect(getToken).toHaveBeenCalledTimes(2);
  expect(sockets).toHaveLength(2);
  vi.useRealTimers();
});
