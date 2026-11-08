import { expect, test } from "vite-plus/test";
import {
  CreatePostInput,
  CreateTeamInput,
  ListUsersQuery,
  OpenGroupInput,
  PostOutput,
} from "../src/index.ts";

test("create team input validates", () => {
  expect(CreateTeamInput.parse({ name: "acme", displayName: "Acme", type: "open" }).name).toBe(
    "acme",
  );
  expect(() =>
    CreateTeamInput.parse({ name: "bad name!", displayName: "x", type: "open" }),
  ).toThrow();
});

test("group input bounds", () => {
  expect(OpenGroupInput.parse({ userIds: ["a", "b"] }).userIds).toHaveLength(2);
  expect(() => OpenGroupInput.parse({ userIds: ["a"] })).toThrow();
});

test("create post input carries attachment descriptors", () => {
  const parsed = CreatePostInput.parse({
    message: "hi",
    attachments: [{ fileId: "upl_1", name: "a.png", mime: "image/png", size: 10 }],
  });
  expect(parsed.attachments?.[0]?.fileId).toBe("upl_1");
  expect(() => CreatePostInput.parse({ message: "hi", attachments: [{ name: "x" }] })).toThrow();
});

test("create post input allows a file-only post but not an empty one", () => {
  expect(
    CreatePostInput.parse({ message: "", attachments: [{ fileId: "upl_1" }] }).attachments,
  ).toHaveLength(1);
  expect(() => CreatePostInput.parse({ message: "" })).toThrow();
  expect(() => CreatePostInput.parse({ message: "   " })).toThrow();
});

test("post output keeps attachments through the schema", () => {
  const post = PostOutput.parse({
    id: "msg_1",
    seq: 1,
    userId: "usr_1",
    parentId: null,
    type: "file",
    content: "",
    attachments: [{ fileId: "upl_1", thumbUrl: "/api/v1/files/upl_1/thumbnail" }],
    mentions: null,
    editedAt: null,
    deletedAt: null,
    createdAt: 1,
    isPinned: false,
  });
  expect(post.attachments?.[0]?.fileId).toBe("upl_1");
});

test("list users query requires a non-empty ids string", () => {
  expect(ListUsersQuery.parse({ ids: "usr_a,usr_b" }).ids).toBe("usr_a,usr_b");
  expect(() => ListUsersQuery.parse({ ids: "" })).toThrow();
});
