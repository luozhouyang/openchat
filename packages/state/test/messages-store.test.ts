import { expect, test } from "vite-plus/test";
import { useMessageStore, type StoreMessage } from "../src/stores/messages.ts";

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

const resetStore = () => useMessageStore.setState({ channels: {}, threads: {} });

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

test("pending sends never occupy the seq space", () => {
  const s = useMessageStore.getState();
  s.reset("c1");
  s.ingest("c1", msg(1));
  s.appendPending("c1", "tok", { ...msg(0), id: "pending-tok", content: "sending" });
  // maxSeq stays at server truth: mark_read and gap detection are unaffected
  expect(useMessageStore.getState().maxSeq("c1")).toBe(1);
  const list = useMessageStore.getState().list("c1");
  expect(list.map((m) => m.id)).toEqual(["m1", "pending-tok"]);
  // A concurrent real message at the seq the optimistic UI used to fake still lands
  s.ingest("c1", msg(2));
  expect(
    useMessageStore
      .getState()
      .list("c1")
      .map((m) => m.id),
  ).toEqual(["m1", "m2", "pending-tok"]);
});

test("ack replaces pending message with real id and seq", () => {
  const s = useMessageStore.getState();
  s.reset("c3");
  s.ingest("c3", msg(1));
  s.appendPending("c3", "tok1", { ...msg(0), id: "pending-tok1" });
  s.ack("c3", "tok1", { id: "real-2", seq: 2 });
  const list = useMessageStore.getState().list("c3");
  expect(list.map((m) => m.id)).toEqual(["m1", "real-2"]);
  expect(list[1].seq).toBe(2);
  expect(useMessageStore.getState().maxSeq("c3")).toBe(2);
});

test("ack re-ingests ahead real seq and fills the gap", () => {
  const s = useMessageStore.getState();
  s.reset("c4");
  s.ingest("c4", msg(1));
  s.appendPending("c4", "tok2", { ...msg(0), id: "pending-tok2" });
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

test("fail removes pending message without touching maxSeq", () => {
  const s = useMessageStore.getState();
  s.reset("c5");
  s.ingest("c5", msg(1));
  s.appendPending("c5", "tok3", { ...msg(0), id: "pending-tok3" });
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

test("ingestThread stores replies by channelId:parentId, sorted and deduped", () => {
  const s = useMessageStore.getState();
  const replyA = { ...msg(3), parentId: "root-1", id: "ra" };
  const replyB = { ...msg(2), parentId: "root-1", id: "rb" };
  s.ingestThread("c1", replyA);
  s.ingestThread("c1", replyB);
  s.ingestThread("c1", replyA);
  expect(
    useMessageStore
      .getState()
      .threadList("c1", "root-1")
      .map((m) => m.id),
  ).toEqual(["rb", "ra"]);
  expect(useMessageStore.getState().threadList("c1", "root-2")).toEqual([]);
  expect(useMessageStore.getState().threadList("c2", "root-1")).toEqual([]);
  s.ingestThread("c1", { ...msg(9), parentId: null, id: "orphan" });
  expect(useMessageStore.getState().threadList("c1", "")).toEqual([]);
});

test("ingestThread isolates replies with same parentId across channels", () => {
  resetStore();
  const s = useMessageStore.getState();
  s.ingestThread("c1", { ...msg(1), parentId: "root-1", id: "r-c1" });
  s.ingestThread("c2", { ...msg(1), parentId: "root-1", id: "r-c2" });
  expect(
    useMessageStore
      .getState()
      .threadList("c1", "root-1")
      .map((m) => m.id),
  ).toEqual(["r-c1"]);
  expect(
    useMessageStore
      .getState()
      .threadList("c2", "root-1")
      .map((m) => m.id),
  ).toEqual(["r-c2"]);
});

test("setReactions only affects threads in the same channel", () => {
  resetStore();
  const s = useMessageStore.getState();
  s.reset("c1");
  s.reset("c2");
  s.ingest("c1", msg(1));
  s.ingest("c2", msg(1));
  s.ingestThread("c1", { ...msg(1), parentId: "root-1", id: "t-c1" });
  s.ingestThread("c2", { ...msg(1), parentId: "root-1", id: "t-c2" });
  s.setReactions("c1", 1, { "👍": ["u1"] });
  expect(useMessageStore.getState().threadList("c1", "root-1")[0].reactions).toEqual({
    "👍": ["u1"],
  });
  expect(useMessageStore.getState().threadList("c2", "root-1")[0].reactions).toBeUndefined();
  expect(useMessageStore.getState().list("c1")[0].reactions).toEqual({ "👍": ["u1"] });
  expect(useMessageStore.getState().list("c2")[0].reactions).toBeUndefined();
});

test("edit and remove propagate to thread entries", () => {
  resetStore();
  const s = useMessageStore.getState();
  s.reset("c1");
  s.ingest("c1", msg(1));
  s.ingestThread("c1", { ...msg(1), parentId: "root-1", id: "t1" });
  s.edit("c1", "t1", "edited text");
  expect(useMessageStore.getState().threadList("c1", "root-1")[0].content).toBe("edited text");
  expect(useMessageStore.getState().threadList("c1", "root-1")[0].editedAt).toBeTruthy();
  s.remove("c1", "t1");
  expect(useMessageStore.getState().threadList("c1", "root-1")[0].deletedAt).toBeTruthy();
  expect(useMessageStore.getState().threadList("c2", "root-1")).toEqual([]);
});

test("edit on pending message is a no-op (server events never target pendings)", () => {
  resetStore();
  const s = useMessageStore.getState();
  s.reset("c1");
  s.appendPending("c1", "tok", { ...msg(0), id: "pending-tok" });
  s.edit("c1", "pending-tok", "x");
  expect(useMessageStore.getState().list("c1")[0].content).toBe("c0");
});

test("sidebar store: bump, markRead and cross-device readSync", async () => {
  const { useSidebarStore } = await import("../src/stores/sidebar.ts");
  useSidebarStore.setState({ entries: {} });
  const s = useSidebarStore.getState();
  s.bump("c1");
  s.bump("c1");
  expect(useSidebarStore.getState().entries["c1"].unread).toBe(2);
  s.markRead("c1");
  expect(useSidebarStore.getState().entries["c1"].unread).toBe(0);
  s.bump("c1");
  s.readSync("c1", 10); // another device read up to seq 10
  const entry = useSidebarStore.getState().entries["c1"];
  expect(entry.unread).toBe(0);
  expect(entry.lastReadSeq).toBe(10);
  s.readSync("c1", 3); // stale echo from a lagging device must not resurrect state
  expect(useSidebarStore.getState().entries["c1"].lastReadSeq).toBe(10);
});

test("connection and typing stores keep their semantics", async () => {
  const { useConnectionStore } = await import("../src/stores/connection.ts");
  const { useTypingStore } = await import("../src/stores/typing.ts");
  useConnectionStore.getState().set("open");
  expect(useConnectionStore.getState().state).toBe("open");
  useTypingStore.setState({ active: {} });
  useTypingStore.getState().mark("c1", "u1", Date.now() + 1000);
  expect(useTypingStore.getState().list("c1")).toEqual(["u1"]);
});

test("store message type accepts optional reactions (superset of protocol Message)", () => {
  const m: StoreMessage = { ...msg(1), reactions: { "👍": ["u1"] } };
  expect(m.reactions).toBeDefined();
});

/**
 * Review #12: edit/remove/setReactions mutate bySeq value objects in place —
 * paired with react-app's `useShallow(s.list(channelId))` that meant unchanged
 * element references, so the main list never re-rendered. These tests pin the
 * clone-on-write contract: every mutator must produce NEW message references.
 */
test("edit produces a new reference for the edited message", () => {
  const s = useMessageStore.getState();
  s.reset("c-r1");
  s.ingest("c-r1", msg(1));
  s.ingest("c-r1", msg(2));
  const before = useMessageStore.getState().list("c-r1");
  s.edit("c-r1", "m1", "edited");
  const after = useMessageStore.getState().list("c-r1");
  expect(before.find((m) => m.id === "m1")).not.toBe(after.find((m) => m.id === "m1"));
  expect(before.find((m) => m.id === "m2")).toBe(after.find((m) => m.id === "m2"));
  expect(after.find((m) => m.id === "m1")?.content).toBe("edited");
});

test("remove produces a new reference with deletedAt set", () => {
  const s = useMessageStore.getState();
  s.reset("c-r2");
  s.ingest("c-r2", msg(1));
  const before = useMessageStore.getState().list("c-r2");
  s.remove("c-r2", "m1");
  const after = useMessageStore.getState().list("c-r2");
  expect(after[0]).not.toBe(before[0]);
  expect(after[0].deletedAt).toBeTruthy();
  expect(before[0].deletedAt).toBeNull();
});

test("setReactions produces a new reference for the reacted message", () => {
  const s = useMessageStore.getState();
  s.reset("c-r3");
  s.ingest("c-r3", msg(1));
  s.ingest("c-r3", msg(2));
  const before = useMessageStore.getState().list("c-r3");
  s.setReactions("c-r3", 1, { "👍": ["u1"] });
  const after = useMessageStore.getState().list("c-r3");
  expect(after[0]).not.toBe(before[0]);
  expect(after[1]).toBe(before[1]);
  expect(after[0].reactions).toEqual({ "👍": ["u1"] });
});

test("setPinned merges the message.pinned state into the store (main list + thread)", () => {
  const s = useMessageStore.getState();
  s.reset("c-r4");
  s.ingest("c-r4", msg(1));
  s.ingestThread("c-r4", { ...msg(1), parentId: "root-1" });
  s.setPinned("c-r4", "m1", true);
  const list = useMessageStore.getState().list("c-r4");
  expect(list[0].isPinned).toBe(true);
  expect(useMessageStore.getState().threadList("c-r4", "root-1")[0].isPinned).toBe(true);
  // Unknown ids are inert (post may not be loaded locally).
  expect(() => s.setPinned("c-r4", "ghost", true)).not.toThrow();
  s.setPinned("c-r4", "m1", false);
  expect(useMessageStore.getState().list("c-r4")[0].isPinned).toBe(false);
});
