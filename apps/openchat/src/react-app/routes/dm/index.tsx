import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";

export const Route = createFileRoute("/dm/")({
  component: DmHome,
});

function DmHome() {
  const data = useLoaderData({ from: "/dm" });
  if (data.directs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-zinc-500">
        还没有会话。加入团队或发起私信后即可开始聊天。
      </div>
    );
  }
  return (
    <div className="space-y-1 p-4">
      {data.directs.map((c) => (
        <Link
          key={c.id}
          to="/dm/$channelId"
          params={{ channelId: c.id }}
          className="block rounded px-2 py-1 text-sm hover:bg-zinc-200"
        >
          {c.displayName}
        </Link>
      ))}
    </div>
  );
}
