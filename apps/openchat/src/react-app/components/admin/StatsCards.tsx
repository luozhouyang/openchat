import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

export function StatsCards() {
  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.admin.stats(),
  });
  const items = [
    ["用户", stats.data?.users],
    ["团队", stats.data?.teams],
    ["频道", stats.data?.channels],
    ["消息", stats.data?.messages],
  ] as const;
  return (
    <div className="grid grid-cols-4 gap-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded border p-4 text-center">
          <p className="text-2xl font-semibold">{value ?? "—"}</p>
          <p className="text-sm text-zinc-500">{label}</p>
        </div>
      ))}
    </div>
  );
}
