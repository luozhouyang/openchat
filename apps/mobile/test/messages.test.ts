import { beforeEach, expect, jest, test } from "@jest/globals";
import type { Message } from "protocol";
import { createMemoryDatabase, type LocalDatabase } from "state";
import { useMessages } from "../src/stores/messages";
import { dispatch } from "../src/ws/client";
import * as messageDb from "../src/lib/message-db";

// The expo-sqlite native module does not exist under jest; tests inject a
// MemoryMessageDB via the getMessageDB spy (the driver is lazy-loaded, so a
// stub is enough to keep the import chain alive).
jest.mock("expo-sqlite", () => ({
  openDatabaseAsync: async () => {
    throw new Error("expo-sqlite unavailable in jest");
  },
}));

function makeMessage(seq: number, id = `m${seq}`): Message {
  return {
    id,
    seq,
    userId: "u1",
    parentId: null,
    type: "text",
    content: `msg-${seq}`,
    attachments: null,
    mentions: null,
    editedAt: null,
    deletedAt: null,
    createdAt: seq,
  };
}

let db: LocalDatabase;

beforeEach(() => {
  useMessages.getState().reset("c1");
  useMessages.setState({ channels: {}, threads: {} });
  db = createMemoryDatabase();
  jest.spyOn(messageDb, "getMessageDB").mockImplementation(async () => db);
});

test("mobile message store passes the same ingest/sync semantics as web", () => {
  const s = useMessages.getState();
  s.ingest("c1", makeMessage(1));
  s.ingest("c1", makeMessage(3)); // gap → buffered
  expect(useMessages.getState().maxSeq("c1")).toBe(1);
  s.ingest("c1", makeMessage(2)); // drains buffered
  expect(useMessages.getState().maxSeq("c1")).toBe(3);
  expect(
    useMessages
      .getState()
      .list("c1")
      .map((m) => m.seq),
  ).toEqual([1, 2, 3]);
});

test("optimistic sends live outside the seq space until acked", () => {
  const s = useMessages.getState();
  s.ingest("c1", makeMessage(1));
  s.appendPending("c1", "tok", { ...makeMessage(0), id: "pending-tok" });
  expect(useMessages.getState().maxSeq("c1")).toBe(1);
  s.ack("c1", "tok", { id: "real-2", seq: 2 });
  expect(
    useMessages
      .getState()
      .list("c1")
      .map((m) => m.id),
  ).toEqual(["m1", "real-2"]);
});

async function until(cond: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("shared dispatch message.new ingests and persists to the on-device db", async () => {
  dispatch(
    JSON.stringify({
      type: "channel.event",
      channelId: "c1",
      event: { type: "message.new", message: makeMessage(1) },
    }),
  );
  expect(useMessages.getState().list("c1")).toHaveLength(1);
  await until(async () => (await db.messages.maxSeq("c1")) === 1);
  expect(await db.messages.maxSeq("c1")).toBe(1);
});

test("shared dispatch sync.result applies history and persists", async () => {
  dispatch(
    JSON.stringify({
      type: "sync.result",
      channelId: "c1",
      messages: [makeMessage(1), makeMessage(2)],
    }),
  );
  expect(useMessages.getState().maxSeq("c1")).toBe(2);
  await until(async () => (await db.messages.maxSeq("c1")) === 2);
  expect(await db.messages.maxSeq("c1")).toBe(2);
});

test("shared dispatch ignores keepalive and malformed frames", () => {
  expect(() => {
    dispatch("pong");
    dispatch("not json");
  }).not.toThrow();
});

test("in-memory driver (used by unit tests) keeps basic semantics", async () => {
  await db.messages.append("c1", makeMessage(1));
  await db.messages.append("c1", makeMessage(1)); // idempotent upsert
  expect(await db.messages.maxSeq("c1")).toBe(1);
  expect((await db.messages.query("c1", { limit: 10 })).rows).toHaveLength(1);
});
