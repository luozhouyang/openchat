import { expect, test, vi } from "vite-plus/test";
import type { Message, ServerEvent } from "protocol";
import { createMemoryDatabase } from "../src/db/database.ts";
import { createDispatcher } from "../src/realtime/dispatch.ts";
import { buildSyncChannels, createSyncGapHandler } from "../src/realtime/sync.ts";
import { useMessageStore } from "../src/stores/messages.ts";
import { useTeamsStore } from "../src/stores/teams.ts";

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

function setup() {
  useMessageStore.setState({ channels: {}, threads: {} });
  const db = createMemoryDatabase();
  const onMessageNew = vi.fn();
  const onSyncGap = vi.fn();
  const onLocal = vi.fn<(ev: ServerEvent) => void>();
  const dispatch = createDispatcher({
    getDb: async () => db,
    onMessageNew,
    onSyncGap,
    onLocal,
  });
  return { db, dispatch, onMessageNew, onSyncGap, onLocal };
}

test("dispatch ignores keepalive and malformed frames without throwing", () => {
  const { dispatch } = setup();
  expect(() => {
    dispatch("pong");
    dispatch("ping");
    dispatch("not json {");
    dispatch("");
  }).not.toThrow();
});

test("dispatch message.new ingests, persists and fires onMessageNew", async () => {
  const { db, dispatch, onMessageNew } = setup();
  dispatch(
    JSON.stringify({
      type: "channel.event",
      channelId: "c1",
      event: { type: "message.new", message: msg(1) },
    }),
  );
  await vi.waitFor(() => expect(db.messages.maxSeq("c1")).resolves.toBe(1));
  expect(useMessageStore.getState().list("c1")).toHaveLength(1);
  expect(onMessageNew).toHaveBeenCalledWith("c1", msg(1));
});

test("dispatch sync.result applies, persists and passes through", async () => {
  const { db, dispatch, onLocal } = setup();
  dispatch(JSON.stringify({ type: "sync.result", channelId: "c1", messages: [msg(1), msg(2)] }));
  await vi.waitFor(() => expect(db.messages.maxSeq("c1")).resolves.toBe(2));
  expect(useMessageStore.getState().maxSeq("c1")).toBe(2);
  expect(onLocal).toHaveBeenCalledTimes(1);
});

test("dispatch sync.gap triggers the app hook", () => {
  const { dispatch, onSyncGap } = setup();
  dispatch(JSON.stringify({ type: "sync.gap", channelId: "c1" }));
  expect(onSyncGap).toHaveBeenCalledWith("c1");
});

test("dispatch message.pinned merges the pin flag into the store and the local DB", async () => {
  const { db, dispatch } = setup();
  await db.messages.append("c1", msg(1)); // the live history row
  useMessageStore.getState().applySync("c1", [msg(1)]);
  dispatch(
    JSON.stringify({
      type: "channel.event",
      channelId: "c1",
      event: { type: "message.pinned", messageId: "m1", pinned: true },
    }),
  );
  const list = useMessageStore.getState().list("c1");
  expect(list[0].isPinned).toBe(true);
  await vi.waitFor(async () => {
    const { rows } = await db.messages.query("c1", { limit: 10 });
    expect(rows[0]?.isPinned).toBe(true);
  });
  // Unpin also reaches both layers.
  dispatch(
    JSON.stringify({
      type: "channel.event",
      channelId: "c1",
      event: { type: "message.pinned", messageId: "m1", pinned: false },
    }),
  );
  await vi.waitFor(() => expect(useMessageStore.getState().list("c1")[0].isPinned).toBe(false));
  const { rows } = await db.messages.query("c1", { limit: 10 });
  expect(rows[0]?.isPinned).toBe(false);
});

test("dispatch message.new persists the live isPinned flag from the DO broadcast", async () => {
  const { db, dispatch } = setup();
  dispatch(
    JSON.stringify({
      type: "channel.event",
      channelId: "c1",
      event: { type: "message.new", message: { ...msg(1), isPinned: true } },
    }),
  );
  expect(useMessageStore.getState().list("c1")[0].isPinned).toBe(true);
  await vi.waitFor(async () => {
    const { rows } = await db.messages.query("c1", { limit: 10 });
    expect(rows[0]?.isPinned).toBe(true);
  });
});

test("dispatch error with clientToken fails the optimistic message and surfaces via onLocal", () => {
  const { dispatch, onLocal } = setup();
  useMessageStore.getState().appendPending("c1", "tok", { ...msg(0), id: "pending-tok" });
  dispatch(
    JSON.stringify({
      type: "error",
      code: "x",
      message: "boom",
      channelId: "c1",
      clientToken: "tok",
    }),
  );
  expect(useMessageStore.getState().list("c1")).toHaveLength(0);
  expect(onLocal).toHaveBeenCalledTimes(1);
});

test("dispatch ack confirms pending, channel.read syncs sidebar", async () => {
  const { dispatch } = setup();
  const { useSidebarStore } = await import("../src/stores/sidebar.ts");
  useSidebarStore.setState({ entries: {} });
  useMessageStore.getState().appendPending("c1", "tok", { ...msg(0), id: "pending-tok" });
  dispatch(
    JSON.stringify({ type: "ack", channelId: "c1", clientToken: "tok", messageId: "r1", seq: 1 }),
  );
  expect(
    useMessageStore
      .getState()
      .list("c1")
      .map((m) => m.id),
  ).toEqual(["r1"]);
  dispatch(JSON.stringify({ type: "channel.read", channelId: "c1", lastReadSeq: 1 }));
  expect(useSidebarStore.getState().entries["c1"]?.lastReadSeq).toBe(1);
});

test("buildSyncChannels takes lastSeq from db and store, capped at maxChannels", async () => {
  useMessageStore.setState({ channels: {}, threads: {} });
  const db = createMemoryDatabase();

  await db.messages.append("c1", msg(5)); // db ahead of store
  useMessageStore.getState().applySync("c1", [msg(3)]);
  useMessageStore.getState().applySync("c2", [msg(9)]); // store-only channel
  const channels = await buildSyncChannels(db, 1);
  expect(channels).toHaveLength(1); // cap applied
  const all = await buildSyncChannels(db);
  const byId = Object.fromEntries(all.map((c) => [c.channelId, c.lastSeq]));
  expect(byId["c1"]).toBe(5); // max(db, store)
  expect(byId["c2"]).toBe(9);
});

test("createSyncGapHandler pages history backwards (at the server cap) until overlap", async () => {
  useMessageStore.setState({ channels: {}, threads: {} });
  const db = createMemoryDatabase();
  // Server holds seq 1..1200; pages honour the requested limit (like the DO).
  const SERVER_TOP = 1200;
  const fetchHistory = vi.fn(async (channelId: string, beforeSeq?: number, limit = 30) => {
    const top = beforeSeq === undefined ? SERVER_TOP : beforeSeq - 1;
    const bottom = Math.max(1, top - limit + 1);
    const msgs: Message[] = [];
    for (let seq = top; seq >= bottom; seq--) {
      msgs.unshift(msg(seq));
    }
    return msgs;
  });
  useMessageStore.getState().applySync("c1", [msg(30)]); // local head
  const handle = createSyncGapHandler({
    getDb: async () => db,
    fetchHistory,
    backoffMs: 1,
  });
  await handle("c1");
  // Two full 500-message pages (1200..701, 700..201) walk back toward the
  // local head; the trailing page overlaps → closed.
  expect(fetchHistory.mock.calls.length).toBeGreaterThanOrEqual(2);
  // First page requests the server history cap (500), not the 30-message page.
  expect(fetchHistory.mock.calls[0]?.[2]).toBe(500);
  expect(fetchHistory.mock.calls[0]?.[1]).toBeUndefined();
  expect(fetchHistory.mock.calls[1]?.[1]).toBe(701);
  const list = useMessageStore.getState().list("c1");
  expect(list[list.length - 1].seq).toBe(1200);
  expect(await db.messages.maxSeq("c1")).toBe(1200);
});

test("createSyncGapHandler refills the store from the DB — a big landed gap is fully visible in the open channel list", async () => {
  useMessageStore.setState({ channels: {}, threads: {} });
  const db = createMemoryDatabase();
  const SERVER_TOP = 900;
  const fetchHistory = vi.fn(async (channelId: string, beforeSeq?: number, limit = 30) => {
    const top = beforeSeq === undefined ? SERVER_TOP : beforeSeq - 1;
    const bottom = Math.max(1, top - limit + 1);
    const msgs: Message[] = [];
    for (let seq = top; seq >= bottom; seq--) {
      msgs.unshift(msg(seq));
    }
    return msgs;
  });
  useMessageStore.getState().applySync("c1", [msg(50)]); // open channel holds only the head
  useMessageStore.getState().appendPending("c1", "tok", { ...msg(0), id: "pending-tok" });
  const handle = createSyncGapHandler({ getDb: async () => db, fetchHistory, backoffMs: 1 });
  await handle("c1");

  // The walk persists 1..900 to the DB, but the store-side applySync ignores
  // everything ≤ maxSeq — without the refill the main list would keep a hole
  // between seq 50 (local head) and 401 (first backfill page).
  const list = useMessageStore.getState().list("c1");
  expect(list).toHaveLength(901); // 900 confirmed + the surviving pending send
  expect(list[0].seq).toBe(1);
  expect(
    list
      .filter((m) => m.seq > 0)
      .map((m) => m.seq)
      .every((s, i) => s === i + 1),
  ).toBe(true); // no hollow middle
  expect(list[list.length - 1].id).toBe("pending-tok"); // pending kept, at seq 0
});

test("createSyncGapHandler requests big pages and closes a ≥500-message gap", async () => {
  useMessageStore.setState({ channels: {}, threads: {} });
  const db = createMemoryDatabase();
  const SERVER_TOP = 900;
  const fetchHistory = vi.fn(async (channelId: string, beforeSeq?: number, limit = 30) => {
    const top = beforeSeq === undefined ? SERVER_TOP : beforeSeq - 1;
    const bottom = Math.max(1, top - limit + 1);
    const msgs: Message[] = [];
    for (let seq = top; seq >= bottom; seq--) {
      msgs.unshift(msg(seq));
    }
    return msgs;
  });
  useMessageStore.getState().applySync("c1", [msg(50)]);
  const handle = createSyncGapHandler({ getDb: async () => db, fetchHistory, backoffMs: 1 });
  await handle("c1");
  // Page 1 (401..900) is full → page 2 (1..400) reaches the bottom and
  // closes the gap against the local head.
  expect(fetchHistory.mock.calls.length).toBe(2);
  expect(fetchHistory.mock.calls[1]?.[1]).toBe(401);
  const list = useMessageStore.getState().list("c1");
  expect(list[list.length - 1].seq).toBe(900);
  expect(await db.messages.maxSeq("c1")).toBe(900);
});

test("createSyncGapHandler retries a failed walk then gives up with a warning", async () => {
  useMessageStore.setState({ channels: {}, threads: {} });
  const db = createMemoryDatabase();
  let calls = 0;
  const failTimes = 2; // succeeds on the 3rd attempt
  const walk = createSyncGapHandler({
    getDb: async () => db,
    fetchHistory: vi.fn(async () => {
      calls++;
      if (calls <= failTimes) {
        throw new Error("flaky");
      }
      return [msg(1), msg(2)];
    }),
    backoffMs: 1,
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await expect(walk("c1")).resolves.toBeUndefined(); // first retry closes it
    expect(calls).toBe(3);

    const alwaysFail = createSyncGapHandler({
      getDb: async () => db,
      fetchHistory: vi.fn(async () => {
        throw new Error("offline");
      }),
      backoffMs: 1,
    });
    await expect(alwaysFail("c1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("sync.gap: backfill failed"),
      expect.objectContaining({ message: expect.stringContaining("offline") }),
    );
  } finally {
    warn.mockRestore();
  }
});

test("createSyncGapHandler stops quietly when offline wrapper gives up", async () => {
  useMessageStore.setState({ channels: {}, threads: {} });
  const db = createMemoryDatabase();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const handle = createSyncGapHandler({
      getDb: async () => db,
      fetchHistory: vi.fn(async () => {
        throw new Error("offline");
      }),
      backoffMs: 1,
    });
    await expect(handle("c1")).resolves.toBeUndefined();
  } finally {
    warn.mockRestore();
  }
});

test("channel.created adds channel to the store team", () => {
  useTeamsStore.setState({
    teams: [
      {
        id: "t1",
        name: "a",
        displayName: "A",
        type: "open",
        roles: "team_admin",
        archivedAt: null,
        channels: [],
      },
    ],
    directs: [],
    loaded: true,
  });
  const { dispatch } = setup();
  dispatch(
    JSON.stringify({
      type: "channel.created",
      channel: {
        id: "c9",
        teamId: "t1",
        name: "new",
        displayName: "New",
        type: "public",
        member: true,
        archivedAt: null,
      },
    }),
  );
  expect(useTeamsStore.getState().teams[0].channels.map((c) => c.id)).toContain("c9");
});

test("team.updated patches team fields in place", () => {
  useTeamsStore.setState({
    teams: [
      {
        id: "t1",
        name: "a",
        displayName: "A",
        type: "open",
        roles: "team_admin",
        archivedAt: null,
        channels: [],
      },
    ],
    directs: [],
    loaded: true,
  });
  const { dispatch } = setup();
  dispatch(
    JSON.stringify({
      type: "team.updated",
      team: { id: "t1", name: "a", displayName: "Renamed", type: "open", archivedAt: null },
    }),
  );
  expect(useTeamsStore.getState().teams[0].displayName).toBe("Renamed");
});

test("team.member_added adds unknown team, ignores known", () => {
  useTeamsStore.setState({ teams: [], directs: [], loaded: true });
  const { dispatch } = setup();
  const team = {
    id: "t5",
    name: "n",
    displayName: "N",
    type: "open",
    archivedAt: null,
    roles: "team_user",
  };
  dispatch(JSON.stringify({ type: "team.member_added", team, userId: "me" }));
  expect(useTeamsStore.getState().teams).toHaveLength(1);
  dispatch(JSON.stringify({ type: "team.member_added", team, userId: "me" }));
  expect(useTeamsStore.getState().teams).toHaveLength(1);
});

test("team.member_removed drops team only when self is removed", () => {
  useTeamsStore.setState({
    teams: [
      {
        id: "t1",
        name: "a",
        displayName: "A",
        type: "open",
        roles: "team_admin",
        archivedAt: null,
        channels: [],
      },
    ],
    directs: [],
    loaded: true,
  });
  const db = createMemoryDatabase();
  const dispatch = createDispatcher({ getDb: async () => db, selfUserId: () => "me" });
  dispatch(JSON.stringify({ type: "team.member_removed", teamId: "t1", userId: "someone-else" }));
  expect(useTeamsStore.getState().teams).toHaveLength(1);
  dispatch(JSON.stringify({ type: "team.member_removed", teamId: "t1", userId: "me" }));
  expect(useTeamsStore.getState().teams).toHaveLength(0);
});

test("channel.member_removed drops the channel from view only when self is removed", () => {
  useTeamsStore.setState({
    teams: [
      {
        id: "t1",
        name: "a",
        displayName: "A",
        type: "open",
        roles: "team_admin",
        archivedAt: null,
        channels: [
          {
            id: "c1",
            teamId: "t1",
            name: "general",
            displayName: "General",
            type: "public",
            member: true,
            archivedAt: null,
          },
        ],
      },
    ],
    directs: [],
    loaded: true,
  });
  const db = createMemoryDatabase();
  const dispatch = createDispatcher({ getDb: async () => db, selfUserId: () => "me" });
  dispatch(
    JSON.stringify({ type: "channel.member_removed", channelId: "c1", userId: "someone-else" }),
  );
  expect(useTeamsStore.getState().teams[0].channels).toHaveLength(1);
  dispatch(JSON.stringify({ type: "channel.member_removed", channelId: "c1", userId: "me" }));
  expect(useTeamsStore.getState().teams[0].channels).toHaveLength(0);
});

test("malformed event frames are dropped by schema validation", () => {
  const { dispatch, onLocal } = setup();
  expect(() => dispatch(JSON.stringify({ type: "channel.created" }))).not.toThrow();
  expect(onLocal).not.toHaveBeenCalled();
});
