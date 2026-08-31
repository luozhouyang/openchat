import { useRef, useState } from "react";
import { wsClient } from "../../ws/client";
import { useMessageStore } from "../../stores/messages";
import { Button } from "../ui/button";
import { UploadButton } from "../upload/UploadButton";
import type { ClientFrame } from "protocol";

export function Composer({ channelId }: { channelId: string }) {
  const [text, setText] = useState("");
  const lastTypingSent = useRef(0);

  function send() {
    const content = text.trim();
    if (!content) return;
    const clientToken = crypto.randomUUID();
    const maxSeq = useMessageStore.getState().maxSeq(channelId);
    useMessageStore.getState().ingest(channelId, {
      id: `pending-${clientToken}`,
      seq: maxSeq + 1,
      userId: "me",
      parentId: null,
      type: "text",
      content,
      attachments: null,
      mentions: null,
      editedAt: null,
      deletedAt: null,
      createdAt: Date.now(),
    });
    wsClient.send({
      type: "post_message",
      channelId,
      content,
      clientToken,
    } as unknown as ClientFrame);
    setText("");
  }

  return (
    <div className="flex gap-2 border-t p-3">
      <UploadButton channelId={channelId} onUploaded={() => {}} />
      <input
        className="flex-1 rounded border px-3 py-2 text-sm"
        value={text}
        placeholder="输入消息…"
        onChange={(e) => {
          setText(e.target.value);
          const now = Date.now();
          if (now - lastTypingSent.current > 3000) {
            lastTypingSent.current = now;
            wsClient.send({ type: "typing", channelId });
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <Button onClick={send}>发送</Button>
    </div>
  );
}
