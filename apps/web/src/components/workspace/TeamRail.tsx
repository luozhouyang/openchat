import { Link } from "@tanstack/react-router";

export function TeamRail({
  teams,
  currentTeamId,
}: {
  teams: Array<{ id: string; displayName: string }>;
  currentTeamId: string;
}) {
  return (
    <nav className="flex w-14 flex-col items-center gap-2 border-r bg-zinc-900 py-3">
      {teams.map((t) => (
        <Link
          key={t.id}
          to="/$teamId"
          params={{ teamId: t.id }}
          className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-semibold ${
            t.id === currentTeamId
              ? "bg-blue-600 text-white"
              : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
          }`}
          title={t.displayName}
        >
          {t.displayName.slice(0, 2)}
        </Link>
      ))}
    </nav>
  );
}
