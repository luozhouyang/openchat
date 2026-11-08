import { useTranslation } from "react-i18next";

const COLORS: Record<string, string> = {
  online: "bg-emerald-500",
  away: "bg-amber-500",
  dnd: "bg-red-500",
  offline: "bg-zinc-400",
};

export function StatusDot({ status, className }: { status: string; className?: string }) {
  const { t } = useTranslation();
  const label = t(`presence.${status}`, { defaultValue: status });
  return (
    <span
      aria-hidden="true"
      title={label}
      className={`inline-block size-2 rounded-full ${COLORS[status] ?? COLORS.offline} ${
        className ?? ""
      }`}
    />
  );
}
