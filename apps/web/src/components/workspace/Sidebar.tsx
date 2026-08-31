import { Link } from "@tanstack/react-router";
import type { ChannelSummary } from "protocol";
import { useSidebarStore } from "../../stores/sidebar";
import { Badge } from "../ui/badge";

interface Team {
  id: string;
  displayName: string;
  channels: ChannelSummary[];
}

export function Sidebar({ team }: { team: Team }) {
  const entries = useSidebarStore((s) => s.entries);
  const channels = team.channels.filter((c) => c.member);
  const normal = channels.filter((c) => c.type === "public" || c.type === "private");
  const dms = channels.filter((c) => c.type === "dm" || c.type === "gm");

  return (
    <aside className="flex w-60 flex-col border-r bg-zinc-50">
      <div className="border-b px-3 py-2 font-semibold">{team.displayName}</div>
      <div className="flex-1 overflow-y-auto p-2">
        <p className="px-2 py-1 text-xs font-medium text-zinc-500">频道</p>
        {normal.map((c) => {
          const e = entries[c.id];
          return (
            <Link
              key={c.id}
              to="/$teamId/c/$channelId"
              params={{ teamId: team.id, channelId: c.id }}
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
        <p className="px-2 py-1 text-xs font-medium text-zinc-500">私信</p>
        {dms.map((c) => (
          <Link
            key={c.id}
            to="/$teamId/dm/$channelId"
            params={{ teamId: team.id, channelId: c.id }}
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
