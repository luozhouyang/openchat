import { beforeEach, expect, test } from "@jest/globals";
import type { Message } from "protocol";
import { MemoryMessageDB } from "state";
import { useMessages } from "../src/stores/messages";
import { dispatch } from "../src/ws/client";
import * as messageDb from "../src/lib/message-db";

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
  useMessages.setState({ channels: {} });
});

test("mobile message store passes the same ingest/sync semantics as web", () => {
  const s = useMessages.getState();
  s.ingest("c1", makeMessage(1));
  s.ingest("c1", makeMessage(3)); // gap → pending
  expect(useMessages.getState().maxSeq("c1")).toBe(1);
  s.ingest("c1", makeMessage(2)); // drains pending
  expect(useMessages.getState().maxSeq("c1")).toBe(3);
  expect(
    useMessages
      .getState()
      .list("c1")
      .map((m) => m.seq),
  ).toEqual([1, 2, 3]);
});

test("dispatch message.new ingests and persists to the local db", async () => {
  const db = new MemoryMessageDB();
  await db.init("c1");
  const spy = jest.spyOn(messageDb, "persistMessage").mockImplementation(async () => {
    await db.append("c1", makeMessage(1));
  });

  dispatch(
    JSON.stringify({
      type: "channel.event",
      channelId: "c1",
      event: { type: "message.new", message: makeMessage(1) },
    }),
  );

  expect(useMessages.getState().list("c1")).toHaveLength(1);
  expect(spy).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "m1" }));
  expect(await db.maxSeq("c1")).toBe(1);
  spy.mockRestore();
});

test("dispatch sync.result applies history and persists", async () => {
  const db = new MemoryMessageDB();
  await db.init("c1");
  const spy = jest
    .spyOn(messageDb, "persistMessages")
    .mockImplementation(
      async (_c: string, msgs: Parameters<typeof messageDb.persistMessages>[1]) => {
        await db.applyGap("c1", msgs);
      },
    );

  dispatch(
    JSON.stringify({
      type: "sync.result",
      channelId: "c1",
      messages: [makeMessage(1), makeMessage(2)],
    }),
  );

  expect(useMessages.getState().maxSeq("c1")).toBe(2);
  expect(await db.maxSeq("c1")).toBe(2);
  spy.mockRestore();
});

test("dispatch message.edit/remove updates the store and persist", () => {
  const s = useMessages.getState();
  s.ingest("c1", makeMessage(1));

  const editSpy = jest.spyOn(messageDb, "persistEdit").mockImplementation(async () => {});
  dispatch(
    JSON.stringify({
      type: "channel.event",
      channelId: "c1",
      event: { type: "message.edit", messageId: "m1", content: "edited", editedAt: 99 },
    }),
  );
  expect(editSpy).toHaveBeenCalledWith("c1", "m1", "edited", 99);
  expect(useMessages.getState().list("c1")[0].content).toBe("edited");
  editSpy.mockRestore();

  const removeSpy = jest.spyOn(messageDb, "persistRemove").mockImplementation(async () => {});
  dispatch(
    JSON.stringify({
      type: "channel.event",
      channelId: "c1",
      event: { type: "message.delete", messageId: "m1" },
    }),
  );
  expect(removeSpy).toHaveBeenCalledWith("c1", "m1");
  expect(useMessages.getState().list("c1")[0].deletedAt).not.toBeNull();
  removeSpy.mockRestore();
});

test("in-memory driver (used by unit tests) keeps basic semantics", async () => {
  const db = new MemoryMessageDB();
  await db.init("c1");
  await db.append("c1", makeMessage(1));
  await db.append("c1", makeMessage(1)); // idempotent upsert
  expect(await db.maxSeq("c1")).toBe(1);
  expect((await db.query("c1", { limit: 10 })).rows).toHaveLength(1);
});
