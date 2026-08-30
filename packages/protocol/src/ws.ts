import { z } from "zod";

const clientFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("echo"), data: z.string().max(4096) }),
  z.object({ type: z.literal("activity") }),
]);

export type ClientFrame = z.infer<typeof clientFrameSchema>;

export type ServerEvent =
  | { type: "hello"; userId: string; serverTime: number }
  | { type: "channel.event"; channelId: string; event: unknown };

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
