import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ChannelSummary } from "protocol";
import { useSidebarStore } from "@/stores/sidebar";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

interface SidebarProps {
  title: string;
  channels: ChannelSummary[];
  directs: ChannelSummary[];
  teamId?: string;
}

export function Sidebar({ title, channels, directs, teamId }: SidebarProps) {
  const entries = useSidebarStore((s) => s.entries);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  async function leaveTeam(teamId: string, navigate: ReturnType<typeof useNavigate>) {
    await api.teams.leave(teamId);
    setMenuOpen(false);
    await navigate({ to: "/dm" });
  }

  return (
    <aside className="flex w-60 flex-col border-r bg-zinc-50">
      <div className="relative border-b px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{title}</span>
          {teamId && (
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded px-1.5 text-zinc-500 hover:bg-zinc-200"
              aria-label="团队菜单"
            >
              ⋯
            </button>
          )}
        </div>
        {teamId && menuOpen && (
          <div className="absolute right-0 top-full z-10 mt-1 w-40 rounded border bg-white py-1 shadow">
            <Link
              to="/$teamId/settings"
              params={{ teamId }}
              className="block px-3 py-1.5 text-sm hover:bg-zinc-100"
            >
              团队设置
            </Link>
            <Link to="/teams/new" className="block px-3 py-1.5 text-sm hover:bg-zinc-100">
              加入团队
            </Link>
            <button
              type="button"
              onClick={() => void leaveTeam(teamId, navigate)}
              className="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-zinc-100"
            >
              退出团队
            </button>
          </div>
        )}
      </div>
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
