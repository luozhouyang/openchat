import { z } from "zod";
import type { MessageType } from "./enums.ts";

export type PresenceStatus = "online" | "away" | "offline";

export interface Message {
  id: string;
  seq: number;
  userId: string;
  parentId: string | null;
  type: MessageType;
  content: string;
  attachments: unknown[] | null;
  mentions: string[] | null;
  editedAt: number | null;
  deletedAt: number | null;
  createdAt: number;
  /** Pin flag from the REST output / DO broadcasts; absent → unpinned (client default). */
  isPinned?: boolean;
}

export type ChannelEvent =
  | ({ type: "message.new" } & { message: Message })
  | { type: "message.edit"; messageId: string; content: string; editedAt: number }
  | { type: "message.delete"; messageId: string }
  /**
   * Single typing shape (review 2026-11-07 PROTOCOL P2): only `typing.start`
   * is on the wire (ChannelDO `typing()` broadcasts `typing.start`; the bare
   * `typing` literal never had a sender). One alias keeps the type side and
   * the zod side from drifting apart again.
   */
  | TypingEvent
  | { type: "reaction.update"; messageSeq: number; reactions: Record<string, string[]> }
  | { type: "thread.reply"; parentId: string; message: Message }
  /** Matches ChannelDO.pinMessage's broadcast verbatim (channel.ts:545-549). */
  | { type: "message.pinned"; messageId: string; pinned: boolean };

export type TypingEvent = { type: "typing.start"; userId: string; expiresAt: number };

export function messageNewEvent(
  channelId: string,
  message: Message,
): { type: "message.new"; channelId: string; event: ChannelEvent } {
  return { type: "message.new", channelId, event: { type: "message.new", message } };
}

export const messageSchema = z.object({
  id: z.string(),
  seq: z.number(),
  userId: z.string(),
  parentId: z.string().nullable(),
  type: z.string(),
  content: z.string(),
  attachments: z.array(z.unknown()).nullable(),
  mentions: z.array(z.string()).nullable(),
  editedAt: z.number().nullable(),
  deletedAt: z.number().nullable(),
  createdAt: z.number(),
  /** Keep the DO's isPinned through the parse instead of silently stripping it. */
  isPinned: z.boolean().optional(),
});

export const channelEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message.new"), message: messageSchema }),
  z.object({
    type: z.literal("message.edit"),
    messageId: z.string(),
    content: z.string(),
    editedAt: z.number(),
  }),
  z.object({ type: z.literal("message.delete"), messageId: z.string() }),
  z.object({ type: z.literal("typing.start"), userId: z.string(), expiresAt: z.number() }),
  z.object({
    type: z.literal("reaction.update"),
    messageSeq: z.number(),
    reactions: z.record(z.string(), z.array(z.string())),
  }),
  z.object({ type: z.literal("thread.reply"), parentId: z.string(), message: messageSchema }),
  z.object({ type: z.literal("message.pinned"), messageId: z.string(), pinned: z.boolean() }),
]);
export type ChannelEventParsed = z.infer<typeof channelEventSchema>;
