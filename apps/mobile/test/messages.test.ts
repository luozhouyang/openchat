import { beforeEach, expect, jest, test } from "@jest/globals";
import type { Message } from "protocol";
import { useMessages } from "../src/stores/messages";
import { dispatch } from "../src/ws/client";

// The expo-sqlite native module does not exist under jest; the shared
// dispatcher treats persistence as best-effort (catches driver failures),
// so a stub keeps the import chain alive while these tests pin the
// store-level wiring.
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

beforeEach(() => {
  useMessages.getState().reset("c1");
  useMessages.setState({ channels: {}, threads: {} });
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

test("shared dispatch message.new ingests into the store (driver failure tolerated)", () => {
  expect(() => {
    dispatch(
      JSON.stringify({
        type: "channel.event",
        channelId: "c1",
        event: { type: "message.new", message: makeMessage(1) },
      }),
    );
  }).not.toThrow();
  expect(useMessages.getState().list("c1")).toHaveLength(1);
});

test("shared dispatch ignores keepalive and malformed frames", () => {
  expect(() => {
    dispatch("pong");
    dispatch("not json");
  }).not.toThrow();
});
