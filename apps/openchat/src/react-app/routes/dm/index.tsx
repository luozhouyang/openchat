import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { usePermissions } from "@/lib/use-permissions";

export const Route = createFileRoute("/dm/")({
  component: DmHome,
});

function DmHome() {
  const data = useLoaderData({ from: "/dm" });
  const permissions = usePermissions();
  const canCreate = permissions.includes("create_team");
  if (data.directs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-zinc-500">
        <p>还没有会话。加入团队或发起私信后即可开始聊天。</p>
        <div className="flex gap-2">
          {canCreate && (
            <Link
              to="/teams/new"
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              创建团队
            </Link>
          )}
          <Link to="/teams/new" className="rounded border px-3 py-1.5 text-sm hover:bg-zinc-100">
            加入团队
          </Link>
        </div>
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
