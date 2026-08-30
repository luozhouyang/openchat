import { z } from "zod";
import type { Message } from "./events.ts";

const clientFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("echo"), data: z.string().max(4096) }),
  z.object({ type: z.literal("activity") }),
  z.object({
    type: z.literal("post_message"),
    channelId: z.string().min(1),
    content: z.string().min(1).max(16384),
    parentId: z.string().optional(),
    clientToken: z.string().min(1).max(64),
  }),
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
  }),
  z.object({
    type: z.literal("edit_message"),
    channelId: z.string().min(1),
    messageId: z.string().min(1),
    content: z.string().min(1).max(16384),
  }),
  z.object({
    type: z.literal("delete_message"),
    channelId: z.string().min(1),
    messageId: z.string().min(1),
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

export type ServerEvent =
  | { type: "hello"; userId: string; serverTime: number }
  | { type: "channel.event"; channelId: string; event: unknown }
  | { type: "ack"; clientToken: string; channelId: string; messageId: string; seq: number }
  | { type: "error"; clientToken?: string; code: string; message: string }
  | { type: "sync.result"; channelId: string; messages: Message[] }
  | { type: "sync.gap"; channelId: string };

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
