import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface RoleRow {
  id: string;
  name: string;
  displayName: string;
  permissions: string[];
  builtIn: boolean;
}

export function RolesPanel() {
  const catalog = useQuery({ queryKey: ["permissions"], queryFn: api.roles.listPermissions });
  const roles = useQuery<{ roles: RoleRow[] }>({ queryKey: ["roles"], queryFn: api.roles.list });
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState<string | null>(null);

  const allPerms = catalog.data?.permissions ?? [];

  function toggle(roleId: string, perm: string, checked: boolean) {
    setDraft((d) => {
      const cur = d[roleId] ?? roles.data?.roles.find((r) => r.id === roleId)?.permissions ?? [];
      return { ...d, [roleId]: checked ? [...cur, perm] : cur.filter((p) => p !== perm) };
    });
  }

  async function saveRole(role: RoleRow) {
    const next = draft[role.id] ?? role.permissions;
    await api.roles.updatePermissions(role.id, next);
    setSaved(role.name);
    setDraft((d) => {
      const { [role.id]: _omit, ...rest } = d;
      return rest;
    });
  }

  return (
    <div className="space-y-6">
      {roles.data?.roles.map((role) => {
        const checked = draft[role.id] ?? role.permissions;
        return (
          <div key={role.id} className="rounded border p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">{role.name}</h3>
              <span className="text-xs text-zinc-500">{role.builtIn ? "内置" : "自定义"}</span>
            </div>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {allPerms.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked.includes(p)}
                    onChange={(e) => toggle(role.id, p, e.target.checked)}
                  />
                  <span className="font-mono text-xs">{p}</span>
                </label>
              ))}
            </div>
            <Button
              className="mt-3"
              onClick={() => void saveRole(role)}
              disabled={!(role.id in draft)}
            >
              保存
            </Button>
            {saved === role.name && <span className="ml-2 text-sm text-green-600">已保存</span>}
          </div>
        );
      })}
    </div>
  );
}
