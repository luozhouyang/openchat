import type { Message } from "protocol";

export function makeMessage(seq: number, id = `m${seq}`): Message {
  return {
    id,
    seq,
    userId: "u1",
    type: "text",
    content: `msg-${seq}`,
    createdAt: seq,
    parentId: null,
    attachments: null,
    mentions: null,
    editedAt: null,
    deletedAt: null,
  };
}
