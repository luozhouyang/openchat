import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/lib/use-permissions";

export const Route = createFileRoute("/dm/")({
  component: DmHome,
});

function DmHome() {
  const data = useLoaderData({ from: "/dm" });
  const { t } = useTranslation();
  const permissions = usePermissions();
  const canCreate = permissions.includes("create_team");
  if (data.directs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-zinc-500">
        <p>{t("workspace.noConversations")}</p>
        <div className="flex gap-2">
          {canCreate && (
            <Link
              to="/teams/new"
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              {t("workspace.createTeam")}
            </Link>
          )}
          <Link to="/teams/new" className="rounded border px-3 py-1.5 text-sm hover:bg-zinc-100">
            {t("workspace.joinTeam")}
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
