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
}

export type ChannelEvent =
  | ({ type: "message.new" } & { message: Message })
  | { type: "message.edit"; messageId: string; content: string; editedAt: number }
  | { type: "message.delete"; messageId: string }
  | { type: "typing"; userId: string; expiresAt: number }
  | { type: "reaction.update"; messageSeq: number; reactions: Record<string, string[]> }
  | { type: "thread.reply"; parentId: string; message: Message }
  | { type: "typing.start"; userId: string; expiresAt: number };

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
  z.object({ type: z.literal("typing"), userId: z.string(), expiresAt: z.number() }),
  z.object({ type: z.literal("typing.start"), userId: z.string(), expiresAt: z.number() }),
  z.object({
    type: z.literal("reaction.update"),
    messageSeq: z.number(),
    reactions: z.record(z.string(), z.array(z.string())),
  }),
  z.object({ type: z.literal("thread.reply"), parentId: z.string(), message: messageSchema }),
]);
export type ChannelEventParsed = z.infer<typeof channelEventSchema>;
