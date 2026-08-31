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
