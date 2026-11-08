import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "@/lib/api";

const whenFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "short",
  timeStyle: "short",
});

export function AuditTable() {
  const { t } = useTranslation();
  const audit = useQuery({ queryKey: ["admin-audit"], queryFn: () => api.admin.audit(50) });

  if (audit.isPending) {
    return null;
  }

  const entries = audit.data?.entries ?? [];
  if (entries.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">{t("admin.auditEmpty")}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">{t("admin.auditWhen")}</th>
            <th>{t("admin.auditActor")}</th>
            <th>{t("admin.auditAction")}</th>
            <th>{t("admin.auditTarget")}</th>
            <th>{t("admin.status")}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b">
              <td className="py-2 whitespace-nowrap">{whenFormat.format(entry.createdAt)}</td>
              <td className="font-mono text-xs">{entry.actorId}</td>
              <td>{entry.action}</td>
              <td>{entry.target ?? "—"}</td>
              <td>{entry.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
