import type { Message } from "protocol";

export interface ChannelQuery {
  beforeSeq?: number;
  limit: number;
}

export interface MessagePage {
  rows: Message[];
  hasMore: boolean;
}

export interface MessageDB {
  init(channelId: string): Promise<void>;
  append(channelId: string, message: Message): Promise<void>;
  applyGap(channelId: string, messages: Message[]): Promise<void>;
  query(channelId: string, opts: ChannelQuery): Promise<MessagePage>;
  maxSeq(channelId: string): Promise<number>;
  edit(channelId: string, messageId: string, content: string, editedAt: number): Promise<void>;
  remove(channelId: string, messageId: string): Promise<void>;
  close(): Promise<void>;
}
