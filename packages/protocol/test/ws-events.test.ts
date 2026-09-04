import { expect, test } from "vite-plus/test";
import { serverEventSchema, channelCreatedEvent, teamUpdatedEvent } from "../src/index.ts";

const channel = {
  id: "ch1",
  teamId: "team1",
  name: "general",
  displayName: "General",
  type: "public",
  member: true,
  archivedAt: null,
};

test("channel.created parses with full ChannelSummary payload", () => {
  const parsed = serverEventSchema.parse({ type: "channel.created", channel });
  expect(parsed).toEqual({ type: "channel.created", channel });
  expect(channelCreatedEvent.parse({ type: "channel.created", channel }).channel.id).toBe("ch1");
});

test("team.updated parses and rejects missing fields", () => {
  const team = { id: "team1", name: "acme", displayName: "Acme", type: "open", archivedAt: null };
  expect(serverEventSchema.parse({ type: "team.updated", team })).toMatchObject({
    type: "team.updated",
  });
  expect(teamUpdatedEvent.parse({ type: "team.updated", team }).team.id).toBe("team1");
  expect(() => serverEventSchema.parse({ type: "team.updated", team: { id: "team1" } })).toThrow();
});

test("unknown event type and bad payloads are rejected", () => {
  expect(serverEventSchema.safeParse({ type: "nope" }).success).toBe(false);
  expect(serverEventSchema.safeParse({ type: "channel.deleted" }).success).toBe(false);
  expect(
    serverEventSchema.safeParse({ type: "channel.member_added", channelId: "c", userId: "u" })
      .success,
  ).toBe(false);
});

test("legacy events still parse", () => {
  expect(serverEventSchema.parse({ type: "hello", userId: "u1", serverTime: 1 }).type).toBe(
    "hello",
  );
  expect(
    serverEventSchema.parse({ type: "channel.read", channelId: "c1", lastReadSeq: 3 }).type,
  ).toBe("channel.read");
  expect(serverEventSchema.parse({ type: "structure.update", scope: "channels" }).type).toBe(
    "structure.update",
  );
});
