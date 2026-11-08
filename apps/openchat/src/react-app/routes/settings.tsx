import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useMe } from "@/hooks/use-me";
import { applyTheme, getTheme, type Theme } from "@/lib/theme";
import { setLanguage } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeftIcon } from "lucide-react";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const THEMES: Theme[] = ["light", "dark", "system"];
const LANGUAGES = [
  { code: "zh", label: "中文" },
  { code: "en", label: "English" },
] as const;

function SettingsPage() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const [theme, setTheme] = useState<Theme>(getTheme());
  const [permission, setPermission] = useState<string>(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const [pushError, setPushError] = useState<string | null>(null);

  function chooseTheme(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  async function enablePush() {
    setPushError(null);
    if (typeof Notification === "undefined") {
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result !== "granted") {
      return;
    }
    try {
      const { publicKey } = await api.push.vapidPublicKey();
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });
      const json = sub.toJSON();
      await api.push.subscribe({
        deviceId: localStorage.getItem("deviceId") ?? crypto.randomUUID(),
        kind: "webpush",
        endpoint: json.endpoint!,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
      });
    } catch {
      setPushError(t("settings.pushFailed"));
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" render={<Link to="/dm" />}>
          <ArrowLeftIcon />
          {t("settings.back")}
        </Button>
      </div>
      <h1 className="text-xl font-semibold">{t("settings.title")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.profile")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t("settings.name")}</span>
            <span className="truncate">{me?.nickname ?? me?.username ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t("settings.username")}</span>
            <span className="truncate">{me?.username ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t("settings.email")}</span>
            <span className="truncate">{me?.email ?? "—"}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.appearance")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">{t("settings.theme")}</span>
            <div className="flex gap-1">
              {THEMES.map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={theme === value ? "default" : "outline"}
                  aria-pressed={theme === value}
                  onClick={() => chooseTheme(value)}
                >
                  {t(`settings.theme_${value}`)}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">{t("settings.language")}</span>
            <div className="flex gap-1">
              {LANGUAGES.map((language) => (
                <Button
                  key={language.code}
                  size="sm"
                  variant={i18n.language === language.code ? "default" : "outline"}
                  aria-pressed={i18n.language === language.code}
                  onClick={() => setLanguage(language.code)}
                >
                  {language.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.notifications")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {t("settings.pushHint")} {t(`settings.push_${permission}`)}
          </p>
          {pushError && (
            <p role="alert" className="text-sm text-destructive">
              {pushError}
            </p>
          )}
          <Button onClick={() => void enablePush()} disabled={permission === "granted"}>
            {permission === "granted" ? t("settings.pushEnabled") : t("settings.pushEnable")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
