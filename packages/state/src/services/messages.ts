import type { CreatePostInput, PostAttachment } from "protocol";
import type { LocalDatabase } from "../db/database.ts";
import { useMessageStore, type StoreMessage } from "../stores/messages.ts";

export interface MessagesServiceDeps {
  getDb(): Promise<LocalDatabase>;
  createPost(channelId: string, input: CreatePostInput): Promise<{ id: string; seq: number }>;
}

export interface MessagesService {
  /**
   * Optimistic send: the pending message lives outside the server seq space
   * (appendPending → REST create → ack + persist, or fail + restore). The
   * caller supplies the idempotency clientToken.
   */
  send(
    channelId: string,
    content: string,
    clientToken: string,
    base?: Partial<StoreMessage>,
  ): Promise<boolean>;
}

export function createMessagesService(deps: MessagesServiceDeps): MessagesService {
  return {
    async send(channelId, content, clientToken, base) {
      useMessageStore.getState().appendPending(channelId, clientToken, {
        id: `pending-${clientToken}`,
        seq: 0,
        userId: "me",
        parentId: null,
        type: "text",
        content,
        attachments: null,
        mentions: null,
        editedAt: null,
        deletedAt: null,
        createdAt: Date.now(),
        ...base,
      });
      try {
        const posted = await deps.createPost(channelId, {
          message: content,
          clientToken,
          ...(base?.attachments?.length
            ? { attachments: base.attachments as PostAttachment[] }
            : {}),
        });
        useMessageStore.getState().ack(channelId, clientToken, {
          id: posted.id,
          seq: posted.seq,
        });
        const db = await deps.getDb();
        await db.messages.append(channelId, {
          ...base,
          id: posted.id,
          seq: posted.seq,
          userId: base?.userId ?? "me",
          parentId: null,
          type: base?.type ?? "text",
          content,
          attachments: (base?.attachments as PostAttachment[] | undefined) ?? null,
          mentions: null,
          editedAt: null,
          deletedAt: null,
          createdAt: Date.now(),
        });
        return true;
      } catch {
        useMessageStore.getState().fail(channelId, clientToken);
        return false;
      }
    },
  };
}
