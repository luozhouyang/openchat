import { useEffect, useState } from "react";
import { useTypingStore } from "@/stores/typing";

export function TypingIndicator({ channelId }: { channelId: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const users = useTypingStore.getState().list(channelId);
  if (users.length === 0) return <div className="h-5 px-4" />;
  return <div className="h-5 px-4 text-xs text-zinc-500">{users.join("、")} 正在输入…</div>;
}
