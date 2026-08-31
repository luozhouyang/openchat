import { expect, test } from "vite-plus/test";
import {
  CHANNEL_TYPES,
  ChannelTypeSchema,
  TEAM_TYPES,
  USER_STATUSES,
  ROLE_NAMES,
} from "../../src/enums.ts";
import type { ChannelType } from "../../src/enums.ts";

test("enum values match domain vocabulary", () => {
  expect(CHANNEL_TYPES).toEqual(["public", "private", "dm", "gm"]);
  expect(TEAM_TYPES).toEqual(["open", "invite"]);
  expect(USER_STATUSES).toEqual(["online", "away", "dnd", "offline"]);
  expect(ROLE_NAMES).toEqual([
    "system_user",
    "system_admin",
    "team_user",
    "team_admin",
    "channel_user",
    "channel_admin",
  ]);
});

test("zod schema accepts only valid values", () => {
  expect(ChannelTypeSchema.parse("dm")).toBe("dm");
  expect(() => ChannelTypeSchema.parse("bogus")).toThrow();
});

test("ChannelType is the element union of CHANNEL_TYPES", () => {
  const t: ChannelType = CHANNEL_TYPES[0];
  expect(t).toBe("public");
});
