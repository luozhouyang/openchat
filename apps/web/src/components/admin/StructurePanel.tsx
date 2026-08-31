import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { Button } from "../ui/button";

export function StructurePanel() {
  const workspaces = useQuery({
    queryKey: ["admin-workspaces"],
    queryFn: api.workspaces,
  });

  return (
    <div className="space-y-4">
      {workspaces.data?.teams.map((t) => (
        <div key={t.id} className="rounded border p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-medium">{t.displayName}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                fetch(`/admin/teams/${t.id}/archive`, {
                  method: "POST",
                  credentials: "include",
                })
              }
            >
              归档团队
            </Button>
          </div>
          <ul className="space-y-1 text-sm">
            {t.channels.map((c) => (
              <li key={c.id} className="flex items-center justify-between">
                <span># {c.displayName}</span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      fetch(`/admin/channels/${c.id}/archive`, {
                        method: "POST",
                        credentials: "include",
                      })
                    }
                  >
                    归档
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      fetch(`/admin/channels/${c.id}/delete`, {
                        method: "POST",
                        credentials: "include",
                      })
                    }
                  >
                    删除
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
