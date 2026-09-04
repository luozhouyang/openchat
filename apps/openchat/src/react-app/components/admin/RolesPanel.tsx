import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface RoleRow {
  id: string;
  name: string;
  displayName: string;
  permissions: string[];
  builtIn: boolean;
}

export function RolesPanel() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const catalog = useQuery({ queryKey: ["permissions"], queryFn: api.roles.listPermissions });
  const roles = useQuery<{ roles: RoleRow[] }>({ queryKey: ["roles"], queryFn: api.roles.list });
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allPerms = catalog.data?.permissions ?? [];

  function toggle(roleId: string, perm: string, checked: boolean) {
    setDraft((d) => {
      const cur = d[roleId] ?? roles.data?.roles.find((r) => r.id === roleId)?.permissions ?? [];
      return { ...d, [roleId]: checked ? [...cur, perm] : cur.filter((p) => p !== perm) };
    });
  }

  async function saveRole(role: RoleRow) {
    setError(null);
    const next = draft[role.id] ?? role.permissions;
    try {
      await api.roles.updatePermissions(role.id, next);
      setSaved(role.name);
      setDraft((d) => {
        const { [role.id]: _omit, ...rest } = d;
        return rest;
      });
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.saveFailed"));
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {roles.data?.roles.map((role) => {
        const checked = draft[role.id] ?? role.permissions;
        return (
          <Card key={role.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {role.name}
                <Badge variant={role.builtIn ? "default" : "outline"}>
                  {role.builtIn ? t("admin.builtIn") : t("admin.custom")}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {allPerms.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked.includes(p)}
                      onCheckedChange={(isChecked) => toggle(role.id, p, isChecked)}
                    />
                    <span className="font-mono text-xs">{p}</span>
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => void saveRole(role)} disabled={!(role.id in draft)}>
                  {t("admin.save")}
                </Button>
                {saved === role.name && (
                  <span className="text-sm text-green-600">{t("admin.saved")}</span>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
