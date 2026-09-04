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

test("dispatch error with clientToken fails the optimistic message", () => {
  const { dispatch } = setup();
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

test("createSyncGapHandler pages history backwards until overlap", async () => {
  useMessageStore.setState({ channels: {}, threads: {} });
  const db = createMemoryDatabase();
  const fetchHistory = vi.fn(async (channelId: string, beforeSeq?: number) => {
    // Server has seq 1..250; latest page first, then older pages.
    const top = beforeSeq === undefined ? 250 : beforeSeq - 1;
    const msgs: Message[] = [];
    for (let seq = top; seq > top - 100 && seq > 0; seq--) {
      msgs.unshift(msg(seq));
    }
    return msgs;
  });
  useMessageStore.getState().applySync("c1", [msg(30)]); // local head
  const handle = createSyncGapHandler({ getDb: async () => db, fetchHistory });
  await handle("c1");
  expect(fetchHistory.mock.calls.length).toBeGreaterThanOrEqual(2);
  // Fills from local head + 1 up to the latest page
  const list = useMessageStore.getState().list("c1");
  expect(list[list.length - 1].seq).toBe(250);
  expect(await db.messages.maxSeq("c1")).toBe(250);
});

test("createSyncGapHandler stops quietly when offline", async () => {
  useMessageStore.setState({ channels: {}, threads: {} });
  const db = createMemoryDatabase();
  const handle = createSyncGapHandler({
    getDb: async () => db,
    fetchHistory: vi.fn(async () => {
      throw new Error("offline");
    }),
  });
  await expect(handle("c1")).resolves.toBeUndefined();
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

test("malformed event frames are dropped by schema validation", () => {
  const { dispatch, onLocal } = setup();
  expect(() => dispatch(JSON.stringify({ type: "channel.created" }))).not.toThrow();
  expect(onLocal).not.toHaveBeenCalled();
});
