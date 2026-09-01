import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { wsClient } from "../../ws/client";
import { useMessageStore } from "../../stores/messages";
import { Button } from "../ui/button";
import { UploadButton } from "../upload/UploadButton";

export function Composer({ channelId }: { channelId: string }) {
  const [text, setText] = useState("");
  const lastTypingSent = useRef(0);

  async function send() {
    const content = text.trim();
    if (!content) return;
    const clientToken = crypto.randomUUID();
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
    });
    setText("");
    try {
      const posted = await api.posts.create(channelId, { message: content, clientToken });
      useMessageStore.getState().ack(channelId, clientToken, { id: posted.id, seq: posted.seq });
    } catch {
      useMessageStore.getState().fail(channelId, clientToken);
      setText(content);
    }
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
            void send();
          }
        }}
      />
      <Button onClick={() => void send()}>发送</Button>
    </div>
  );
}
