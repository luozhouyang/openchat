import { expect, test } from "vite-plus/test";
// The full store semantics suite lives in packages/state (canonical shared
// layer); here we only pin the re-export wiring the web app relies on.
import { useMessageStore } from "@/stores/messages";
import { useConnectionStore } from "@/stores/connection";
import { useSidebarStore } from "@/stores/sidebar";
import { useTypingStore } from "@/stores/typing";

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

test("web stores re-export the shared state package", () => {
  useMessageStore.setState({ channels: {}, threads: {} });
  useMessageStore.getState().reset("c1");
  useMessageStore.getState().ingest("c1", msg(1));
  useMessageStore.getState().appendPending("c1", "tok", { ...msg(0), id: "pending-tok" });
  expect(useMessageStore.getState().maxSeq("c1")).toBe(1); // pending never advances seq
  expect(
    useMessageStore
      .getState()
      .list("c1")
      .map((m) => m.id),
  ).toEqual(["m1", "pending-tok"]);

  useConnectionStore.getState().set("open");
  expect(useConnectionStore.getState().state).toBe("open");

  useSidebarStore.setState({ entries: {} });
  useSidebarStore.getState().bump("c1");
  expect(useSidebarStore.getState().entries["c1"].unread).toBe(1);

  useTypingStore.setState({ active: {} });
  useTypingStore.getState().mark("c1", "u1", Date.now() + 1000);
  expect(useTypingStore.getState().list("c1")).toEqual(["u1"]);
});
