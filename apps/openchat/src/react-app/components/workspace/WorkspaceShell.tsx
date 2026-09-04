import { Outlet } from "@tanstack/react-router";
import type { ChannelSummary } from "protocol";
import { TeamRail } from "./TeamRail";
import { Sidebar } from "./Sidebar";

interface WorkspaceShellProps {
  teams: Array<{ id: string; displayName: string }>;
  currentTeamId: string | null;
  title: string;
  channels: ChannelSummary[];
  directs: ChannelSummary[];
}

export function WorkspaceShell({
  teams,
  currentTeamId,
  title,
  channels,
  directs,
}: WorkspaceShellProps) {
  return (
    <div className="flex h-screen">
      {currentTeamId && <TeamRail teams={teams} currentTeamId={currentTeamId} />}
      <Sidebar
        title={title}
        channels={channels}
        directs={directs}
        teamId={currentTeamId ?? undefined}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
