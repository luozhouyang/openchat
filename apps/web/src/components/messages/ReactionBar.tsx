import { wsClient } from "../../ws/client";

export function ReactionBar({
  channelId,
  messageSeq,
  reactions,
}: {
  channelId: string;
  messageSeq: number;
  reactions: Record<string, string[]>;
}) {
  return (
    <div className="mt-1 flex gap-1">
      {Object.entries(reactions).map(([emoji, users]) => (
        <button
          key={emoji}
          className="rounded-full border px-2 py-0.5 text-xs hover:bg-zinc-100"
          onClick={() => wsClient.send({ type: "react", channelId, messageSeq, emoji })}
        >
          {emoji} {users.length}
        </button>
      ))}
    </div>
  );
}
