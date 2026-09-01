import type { Message } from "protocol";

export interface ChannelQuery {
  beforeSeq?: number;
  limit: number;
}

export interface MessagePage {
  rows: Message[];
  hasMore: boolean;
}

/**
 * Message entity repository. Lifecycle (migrations, transactions, close)
 * belongs to LocalDatabase — this is data access only.
 */
export interface MessageRepository {
  append(channelId: string, message: Message): Promise<void>;
  applyGap(channelId: string, messages: Message[]): Promise<void>;
  query(channelId: string, opts: ChannelQuery): Promise<MessagePage>;
  maxSeq(channelId: string): Promise<number>;
  /** Every channel that has at least one locally stored message (sync source). */
  listChannels(): Promise<string[]>;
  edit(channelId: string, messageId: string, content: string, editedAt: number): Promise<void>;
  remove(channelId: string, messageId: string): Promise<void>;
}
