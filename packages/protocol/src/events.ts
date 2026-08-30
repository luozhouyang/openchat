export type PresenceStatus = "online" | "away" | "offline";

export interface Message {
  id: string;
  seq: number;
  userId: string;
  parentId: string | null;
  type: "text" | "file" | "system";
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
  | { type: "presence"; userId: string; status: "online" | "away" | "offline" }
  | { type: "reaction.update"; messageSeq: number; reactions: Record<string, string[]> }
  | { type: "thread.reply"; parentId: string; message: Message }
  | { type: "typing.start"; userId: string; expiresAt: number };

export function messageNewEvent(
  channelId: string,
  message: Message,
): { type: "message.new"; channelId: string; event: ChannelEvent } {
  return { type: "message.new", channelId, event: { type: "message.new", message } };
}
