import { z } from "zod";
import { TeamTypeSchema } from "./enums.ts";
import { channelEventSchema, messageSchema } from "./events.ts";
import { ChannelSummary } from "./rest.ts";

const clientFrameSchema = z.discriminatedUnion("type", [
  /**
   * Dead frame kept for wire-bisect compatibility: no client (web/mobile/
   * desktop) ever sends `echo`; the UserDO still answers it (user.ts:728) and
   * a worker test pins that behavior. The worker-side echo handler is not yet
   * retired — remove this branch only together with that handler.
   */
  z.object({ type: z.literal("echo"), data: z.string().max(4096) }),
  z.object({ type: z.literal("activity") }),
  z.object({
    type: z.literal("mark_read"),
    channelId: z.string().min(1),
    seq: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("sync"),
    channels: z
      .array(z.object({ channelId: z.string().min(1), lastSeq: z.number().int().nonnegative() }))
      .max(500),
  }),
  z.object({
    type: z.literal("react"),
    channelId: z.string().min(1),
    messageSeq: z.number().int().positive(),
    emoji: z.string().min(1).max(8),
    /**
     * Local idempotency/correlation token (protocol id generator). When the
     * react is rejected (rate limit, gate) the UserDO's error frame echoes it
     * back with the channelId so the dispatcher can surface the failure —
     * see user.ts:837-846 and the error server event below.
     */
    clientToken: z.string().optional(),
  }),
  z.object({
    type: z.literal("typing"),
    channelId: z.string().min(1),
  }),
  z.object({
    type: z.literal("subscribe_thread"),
    channelId: z.string().min(1),
    parentId: z.string().min(1),
    subscribe: z.boolean(),
  }),
]);

export type ClientFrame = z.infer<typeof clientFrameSchema>;

export const channelCreatedEvent = z.object({
  type: z.literal("channel.created"),
  channel: ChannelSummary,
});
export const channelUpdatedEvent = z.object({
  type: z.literal("channel.updated"),
  channel: ChannelSummary,
});
export const channelDeletedEvent = z.object({
  type: z.literal("channel.deleted"),
  channelId: z.string().min(1),
});
export const channelMemberAddedEvent = z.object({
  type: z.literal("channel.member_added"),
  channelId: z.string().min(1),
  userId: z.string().min(1),
  roles: z.string(),
});
export const channelMemberRemovedEvent = z.object({
  type: z.literal("channel.member_removed"),
  channelId: z.string().min(1),
  userId: z.string().min(1),
});
export const TeamUpdatePayload = z.object({
  id: z.string().min(1),
  name: z.string(),
  displayName: z.string(),
  type: TeamTypeSchema,
  archivedAt: z.number().nullable(),
});
export type TeamUpdatePayload = z.infer<typeof TeamUpdatePayload>;
export const teamUpdatedEvent = z.object({
  type: z.literal("team.updated"),
  team: TeamUpdatePayload,
});
export const teamMemberAddedEvent = z.object({
  type: z.literal("team.member_added"),
  team: TeamUpdatePayload.extend({ roles: z.string() }),
  userId: z.string().min(1),
});
export const teamMemberRemovedEvent = z.object({
  type: z.literal("team.member_removed"),
  teamId: z.string().min(1),
  userId: z.string().min(1),
});
export type ChannelCreatedEvent = z.infer<typeof channelCreatedEvent>;
export type ChannelUpdatedEvent = z.infer<typeof channelUpdatedEvent>;
export type ChannelDeletedEvent = z.infer<typeof channelDeletedEvent>;
export type ChannelMemberAddedEvent = z.infer<typeof channelMemberAddedEvent>;
export type ChannelMemberRemovedEvent = z.infer<typeof channelMemberRemovedEvent>;
export type TeamUpdatedEvent = z.infer<typeof teamUpdatedEvent>;
export type TeamMemberAddedEvent = z.infer<typeof teamMemberAddedEvent>;
export type TeamMemberRemovedEvent = z.infer<typeof teamMemberRemovedEvent>;

export const serverEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), userId: z.string(), serverTime: z.number() }),
  z.object({ type: z.literal("channel.event"), channelId: z.string(), event: channelEventSchema }),
  /**
   * Optional ack frame: no worker code sends `ack` today — the optimistic
   * message is confirmed from the REST POST response (services/messages.ts).
   * The dispatcher still honors it so a future worker-side ack (or an
   * external client) keeps end-to-end semantics; treat as reserved.
   */
  z.object({
    type: z.literal("ack"),
    clientToken: z.string(),
    channelId: z.string(),
    messageId: z.string(),
    seq: z.number(),
  }),
  /**
   * `clientToken`/`channelId` are the contract for optimistic-send failures
   * and rate-limit rejects (e.g. the `react` frame path in user.ts). The
   * dispatcher fails the matching pending message and surfaces the rest.
   */
  z.object({
    type: z.literal("error"),
    clientToken: z.string().optional(),
    channelId: z.string().optional(),
    code: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal("sync.result"),
    channelId: z.string(),
    messages: z.array(messageSchema),
  }),
  z.object({ type: z.literal("sync.gap"), channelId: z.string() }),
  z.object({
    type: z.literal("sidebar.update"),
    channelId: z.string(),
    unread: z.number(),
    mentions: z.number(),
    lastMessage: z.object({ preview: z.string(), userId: z.string(), at: z.number() }),
  }),
  z.object({ type: z.literal("channel.read"), channelId: z.string(), lastReadSeq: z.number() }),
  channelCreatedEvent,
  channelUpdatedEvent,
  channelDeletedEvent,
  channelMemberAddedEvent,
  channelMemberRemovedEvent,
  teamUpdatedEvent,
  teamMemberAddedEvent,
  teamMemberRemovedEvent,
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;

export function parseClientFrame(raw: string): ClientFrame | null {
  try {
    return clientFrameSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function helloEvent(userId: string): ServerEvent {
  return { type: "hello", userId, serverTime: Date.now() };
}
