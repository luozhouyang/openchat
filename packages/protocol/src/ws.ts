import { z } from "zod";
import type { Message, PresenceStatus } from "./events.ts";

const clientFrameSchema = z.discriminatedUnion("type", [
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
  z.object({
    type: z.literal("presence_subscribe"),
    userIds: z.array(z.string().min(1)).min(1).max(200),
  }),
  z.object({
    type: z.literal("presence_unsubscribe"),
    userIds: z.array(z.string().min(1)).min(1).max(200),
  }),
]);

export type ClientFrame = z.infer<typeof clientFrameSchema>;

export type ServerEvent =
  | { type: "hello"; userId: string; serverTime: number }
  | { type: "channel.event"; channelId: string; event: unknown }
  | { type: "ack"; clientToken: string; channelId: string; messageId: string; seq: number }
  | { type: "error"; clientToken?: string; channelId?: string; code: string; message: string }
  | { type: "sync.result"; channelId: string; messages: Message[] }
  | { type: "sync.gap"; channelId: string }
  | {
      type: "sidebar.update";
      channelId: string;
      unread: number;
      mentions: number;
      lastMessage: { preview: string; userId: string; at: number };
    }
  | { type: "channel.read"; channelId: string; lastReadSeq: number }
  | {
      /** Structure changed (channel/team created or archived, membership changed):
       * clients refetch workspaces + sidebar instead of polling on navigation. */
      type: "structure.update";
      scope: "channels" | "teams";
    }
  | { type: "presence.snapshot"; states: Record<string, PresenceStatus> }
  | { type: "presence.update"; userId: string; status: PresenceStatus };

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
