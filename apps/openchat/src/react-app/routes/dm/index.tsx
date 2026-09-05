import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/lib/use-permissions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dm/")({
  component: DmHome,
});

function DmHome() {
  const data = useLoaderData({ from: "/dm" });
  const permissions = usePermissions();
  const canCreate = permissions.includes("create_team");
  const { t } = useTranslation();
  if (data.directs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-muted-foreground">
        <p>{t("workspace.noConversations")}</p>
        <div className="flex gap-2">
          {canCreate && (
            <Button render={<Link to="/teams/new" search={{ tab: "create" }} />}>
              {t("workspace.createTeam")}
            </Button>
          )}
          <Button variant="outline" render={<Link to="/teams/new" search={{ tab: "join" }} />}>
            {t("workspace.joinTeam")}
          </Button>
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
