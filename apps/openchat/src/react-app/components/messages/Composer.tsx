import { useRef, useState } from "react";
import { appClient } from "@/app-client";
import { wsClient } from "@/ws/client";
import { Button } from "@/components/ui/button";
import { UploadButton } from "@/components/upload/UploadButton";

export function Composer({ channelId }: { channelId: string }) {
  const [text, setText] = useState("");
  const lastTypingSent = useRef(0);

  async function send() {
    const content = text.trim();
    if (!content) {
      return;
    }
    setText("");
    const ok = await appClient.messages.send(channelId, content, crypto.randomUUID());
    if (!ok) {
      setText(content);
    } // failed send restores the draft
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
