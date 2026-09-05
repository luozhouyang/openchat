import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function UserTable() {
  const qc = useQueryClient();
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const res = await authClient.admin.listUsers({ query: { limit: 100 } });
      return res.data;
    },
  });
  const ban = useMutation({
    mutationFn: (userId: string) => authClient.admin.banUser({ userId, banReason: "管理员操作" }),
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
          <th className="py-2">邮箱</th>
          <th>角色</th>
          <th>状态</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {users.data?.users.map((u) => (
          <tr key={u.id} className="border-b">
            <td className="py-2">{u.email}</td>
            <td>{u.role}</td>
            <td>{u.banned ? "已封禁" : "正常"}</td>
            <td className="py-2">
              {u.banned ? (
                <Button size="sm" variant="outline" onClick={() => unban.mutate(u.id)}>
                  解封
                </Button>
              ) : (
                <Button size="sm" variant="destructive" onClick={() => ban.mutate(u.id)}>
                  封禁
                </Button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
