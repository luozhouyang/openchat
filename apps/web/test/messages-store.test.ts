import { expect, test } from "vite-plus/test";
import { useMessageStore } from "../src/stores/messages";

const msg = (seq: number) => ({
  id: `m${seq}`,
  seq,
  userId: "u1",
  parentId: null,
  type: "text" as const,
  content: `c${seq}`,
  attachments: null,
  mentions: null,
  editedAt: null,
  deletedAt: null,
  createdAt: seq,
});

test("ingest in order updates maxSeq", () => {
  const s = useMessageStore.getState();
  s.reset("c1");
  s.ingest("c1", msg(1));
  s.ingest("c1", msg(2));
  expect(useMessageStore.getState().maxSeq("c1")).toBe(2);
  expect(useMessageStore.getState().list("c1")).toHaveLength(2);
});

test("out-of-order seq buffered then flushed", () => {
  const s = useMessageStore.getState();
  s.reset("c2");
  s.ingest("c2", msg(1));
  s.ingest("c2", msg(3));
  expect(useMessageStore.getState().list("c2")).toHaveLength(1);
  s.ingest("c2", msg(2));
  expect(useMessageStore.getState().list("c2")).toHaveLength(3);
});

test("ack replaces pending message with real id and seq", () => {
  const s = useMessageStore.getState();
  s.reset("c3");
  s.ingest("c3", msg(1));
  s.ingest("c3", { ...msg(2), id: "pending-tok1" });
  expect(useMessageStore.getState().maxSeq("c3")).toBe(2);
  s.ack("c3", "tok1", { id: "real-2", seq: 2 });
  const list = useMessageStore.getState().list("c3");
  expect(list.map((m) => m.id)).toEqual(["m1", "real-2"]);
  expect(list[1].seq).toBe(2);
});

test("ack re-ingests ahead real seq and fills the gap", () => {
  const s = useMessageStore.getState();
  s.reset("c4");
  s.ingest("c4", msg(1));
  s.ingest("c4", { ...msg(2), id: "pending-tok2" });
  s.ack("c4", "tok2", { id: "real-4", seq: 4 });
  expect(
    useMessageStore
      .getState()
      .list("c4")
      .map((m) => m.id),
  ).toEqual(["m1"]);
  s.ingest("c4", msg(2));
  s.ingest("c4", msg(3));
  expect(
    useMessageStore
      .getState()
      .list("c4")
      .map((m) => m.id),
  ).toEqual(["m1", "m2", "m3", "real-4"]);
  expect(useMessageStore.getState().maxSeq("c4")).toBe(4);
});

test("fail removes pending message and recomputes maxSeq", () => {
  const s = useMessageStore.getState();
  s.reset("c5");
  s.ingest("c5", msg(1));
  s.ingest("c5", { ...msg(2), id: "pending-tok3" });
  s.fail("c5", "tok3");
  expect(
    useMessageStore
      .getState()
      .list("c5")
      .map((m) => m.id),
  ).toEqual(["m1"]);
  expect(useMessageStore.getState().maxSeq("c5")).toBe(1);
});

test("setReactions updates matching message by seq", () => {
  const s = useMessageStore.getState();
  s.reset("c6");
  s.ingest("c6", msg(1));
  s.ingest("c6", msg(2));
  s.setReactions("c6", 2, { "👍": ["u1"] });
  const list = useMessageStore.getState().list("c6");
  expect(list[1].reactions).toEqual({ "👍": ["u1"] });
  expect(list[0].reactions).toBeUndefined();
});

test("ingestThread stores replies by parent, sorted and deduped", () => {
  const s = useMessageStore.getState();
  const replyA = { ...msg(3), parentId: "root-1", id: "ra" };
  const replyB = { ...msg(2), parentId: "root-1", id: "rb" };
  s.ingestThread(replyA);
  s.ingestThread(replyB);
  s.ingestThread(replyA);
  expect(
    useMessageStore
      .getState()
      .threadList("root-1")
      .map((m) => m.id),
  ).toEqual(["rb", "ra"]);
  expect(useMessageStore.getState().threadList("root-2")).toEqual([]);
  s.ingestThread({ ...msg(9), parentId: null, id: "orphan" });
  expect(useMessageStore.getState().threadList("")).toEqual([]);
});
