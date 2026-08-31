import type { Message } from "protocol";

export function MessageRow({ message }: { message: Message }) {
  if (message.deletedAt) {
    return <div className="px-4 py-1 text-sm italic text-zinc-400">消息已删除</div>;
  }
  return (
    <div className="px-4 py-1 hover:bg-zinc-50">
      <span className="mr-2 text-sm font-semibold">{message.userId}</span>
      <span className="text-sm">{message.content}</span>
      {message.editedAt && <span className="ml-1 text-xs text-zinc-400">(已编辑)</span>}
    </div>
  );
}
