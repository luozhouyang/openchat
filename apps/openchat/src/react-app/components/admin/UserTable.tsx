import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function UserTable() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const res = await authClient.admin.listUsers({ query: { limit: 100 } });
      return res.data;
    },
  });
  const ban = useMutation({
    mutationFn: (userId: string) =>
      authClient.admin.banUser({ userId, banReason: t("admin.banReason") }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });
  const unban = useMutation({
    mutationFn: (userId: string) => authClient.admin.unbanUser({ userId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left">
          <th className="py-2">{t("admin.email")}</th>
          <th>{t("admin.role")}</th>
          <th>{t("admin.status")}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {users.data?.users.map((u) => (
          <tr key={u.id} className="border-b">
            <td className="py-2">{u.email}</td>
            <td>{u.role}</td>
            <td>{u.banned ? t("admin.banned") : t("admin.active")}</td>
            <td className="py-2">
              {u.banned ? (
                <Button size="sm" variant="outline" onClick={() => unban.mutate(u.id)}>
                  {t("admin.unban")}
                </Button>
              ) : (
                <Button size="sm" variant="destructive" onClick={() => ban.mutate(u.id)}>
                  {t("admin.ban")}
                </Button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
