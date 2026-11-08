import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTypingStore } from "@/stores/typing";
import { displayNameOf, useUsersStore } from "@/stores/users";

export function TypingIndicator({ channelId }: { channelId: string }) {
  const { t } = useTranslation();
  const [, force] = useState(0);
  const byId = useUsersStore((s) => s.byId);
  useEffect(() => {
    const timer = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const users = useTypingStore.getState().list(channelId);
  useEffect(() => {
    if (users.length > 0) {
      useUsersStore.getState().ensure(users);
    }
    // `users` is re-derived on every render; key the effect by its contents.
  }, [users.join(",")]);
  if (users.length === 0) {
    return <div className="h-5 px-4" />;
  }
  const names = users.map((userId) => displayNameOf(byId[userId], userId)).join(", ");
  return (
    <div className="h-5 px-4 text-xs text-muted-foreground">{t("messages.typing", { names })}</div>
  );
}
