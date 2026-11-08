import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function StructurePanel() {
  const { t } = useTranslation();
  const workspaces = useQuery({
    queryKey: ["admin-workspaces"],
    queryFn: api.workspaces,
  });

  return (
    <div className="space-y-4">
      {workspaces.data?.teams.map((team) => (
        <div key={team.id} className="rounded border p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-medium">{team.displayName}</p>
            <Button size="sm" variant="outline" onClick={() => void api.admin.archiveTeam(team.id)}>
              {t("admin.archiveTeam")}
            </Button>
          </div>
          <ul className="space-y-1 text-sm">
            {team.channels.map((c) => (
              <li key={c.id} className="flex items-center justify-between">
                <span># {c.displayName}</span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void api.admin.archiveChannel(c.id)}
                  >
                    {t("admin.archive")}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void api.admin.deleteChannel(c.id)}
                  >
                    {t("admin.delete")}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
