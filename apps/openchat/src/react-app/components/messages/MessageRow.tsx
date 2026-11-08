import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { id } from "protocol";
import { wsClient } from "@/ws/client";
import { api } from "@/lib/api";
import { ReactionBar } from "./ReactionBar";
import { AttachmentView } from "@/components/upload/AttachmentView";
import type { StoreMessage } from "@/stores/messages";

export function MessageRow({ message, channelId }: { message: StoreMessage; channelId: string }) {
  const { teamId } = useParams({ strict: false }) as { teamId?: string };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  async function submitEdit() {
    const content = draft.trim();
    setEditing(false);
    if (!content || content === message.content) {
      return;
    }
    await api.posts.patch(message.id, { message: content, channelId });
  }

  async function remove() {
    await api.posts.remove(message.id, { channelId });
  }

  if (message.deletedAt) {
    return <div className="px-4 py-1 text-sm italic text-zinc-400">消息已删除</div>;
  }

  return (
    <div className="group px-4 py-1 hover:bg-zinc-50">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <span className="mr-2 text-sm font-semibold">{message.userId}</span>
          {editing ? (
            <input
              className="w-64 rounded border px-1 text-sm"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void submitEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                  setDraft(message.content);
                }
              }}
            />
          ) : (
            <>
              <span className="text-sm">{message.content}</span>
              {message.editedAt && <span className="ml-1 text-xs text-zinc-400">(已编辑)</span>}
            </>
          )}
        </div>
        <div className="hidden shrink-0 gap-2 text-xs text-zinc-500 group-hover:flex">
          <button
            onClick={() =>
              wsClient.send({
                type: "react",
                channelId,
                messageSeq: message.seq,
                emoji: "👍",
                clientToken: id("int"),
              })
            }
          >
            👍
          </button>
          <Link
            to="/$teamId/c/$channelId/t/$threadId"
            params={{ teamId: teamId ?? "", channelId, threadId: message.id }}
          >
            回复
          </Link>
          <button
            onClick={() => {
              setDraft(message.content);
              setEditing(true);
            }}
          >
            编辑
          </button>
          <button onClick={() => void remove()}>删除</button>
        </div>
      </div>
      {message.reactions && Object.keys(message.reactions).length > 0 && (
        <ReactionBar channelId={channelId} messageSeq={message.seq} reactions={message.reactions} />
      )}
      <AttachmentView message={message} channelId={channelId} />
    </div>
  );
}
