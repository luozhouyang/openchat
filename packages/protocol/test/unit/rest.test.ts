import { expect, test } from "vite-plus/test";
import {
  CreateTeamInput,
  CreateChannelInput,
  CreatePostInput,
  PutStatusInput,
  OpenDirectInput,
  OpenGroupInput,
  ChannelsListOutput,
} from "../../src/rest.ts";

test("input schemas are camelCase", () => {
  expect(CreateTeamInput.shape.displayName).toBeDefined();
  expect(CreateChannelInput.shape.displayName).toBeDefined();
  expect(CreatePostInput.shape.parentId).toBeDefined();
  expect(CreatePostInput.shape.clientToken).toBeDefined();
  expect(PutStatusInput.shape.dndEndTime).toBeDefined();
  expect(OpenDirectInput.shape.userIds).toBeDefined();
  expect(OpenGroupInput.shape.userIds).toBeDefined();
});

test("output schema is camelCase", () => {
  expect(ChannelsListOutput.shape.memberIds).toBeDefined();
});

test("CreateTeamInput validates", () => {
  const ok = CreateTeamInput.safeParse({
    name: "acme",
    displayName: "Acme",
    type: "open",
  });
  expect(ok.success).toBe(true);
  const bad = CreateTeamInput.safeParse({ name: "x", displayName: "A", type: "open" });
  expect(bad.success).toBe(false);
});
