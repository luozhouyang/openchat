import { Link } from "@tanstack/react-router";
import type { ChannelSummary } from "protocol";
import { useSidebarStore } from "@/stores/sidebar";
import { Badge } from "@/components/ui/badge";

interface SidebarProps {
  title: string;
  channels: ChannelSummary[];
  directs: ChannelSummary[];
  teamId?: string;
}

export function Sidebar({ title, channels, directs, teamId }: SidebarProps) {
  const entries = useSidebarStore((s) => s.entries);

  return (
    <aside className="flex w-60 flex-col border-r bg-zinc-50">
      <div className="border-b px-3 py-2 font-semibold">{title}</div>
      <div className="flex-1 overflow-y-auto p-2">
        {teamId && (
          <>
            <p className="px-2 py-1 text-xs font-medium text-zinc-500">频道</p>
            {channels.map((c) => {
              const e = entries[c.id];
              return (
                <Link
                  key={c.id}
                  to="/$teamId/c/$channelId"
                  params={{ teamId, channelId: c.id }}
                  className={`flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-zinc-200 ${e?.unread ? "font-bold" : ""}`}
                  activeProps={{ className: "bg-blue-100" }}
                >
                  <span># {c.displayName}</span>
                  {e && (e.unread > 0 || e.mentions > 0) && (
                    <Badge variant={e.mentions > 0 ? "destructive" : "default"}>
                      {e.mentions > 0 ? `@${e.mentions}` : e.unread}
                    </Badge>
                  )}
                </Link>
              );
            })}
          </>
        )}
        <p className="px-2 py-1 text-xs font-medium text-zinc-500">私信</p>
        {directs.map((c) => (
          <Link
            key={c.id}
            to="/dm/$channelId"
            params={{ channelId: c.id }}
            className="block rounded px-2 py-1 text-sm hover:bg-zinc-200"
            activeProps={{ className: "bg-blue-100" }}
          >
            {c.displayName}
          </Link>
        ))}
      </div>
    </aside>
  );
}