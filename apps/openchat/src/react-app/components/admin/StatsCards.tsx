import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "@/lib/api";

export function StatsCards() {
  const { t } = useTranslation();
  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.admin.stats(),
  });
  const items = [
    [t("admin.statsUsers"), stats.data?.users],
    [t("admin.statsTeams"), stats.data?.teams],
    [t("admin.statsChannels"), stats.data?.channels],
    [t("admin.statsMessages"), stats.data?.messages],
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
