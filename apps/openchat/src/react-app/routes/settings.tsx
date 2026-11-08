import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useMe } from "@/hooks/use-me";
import { applyTheme, getTheme, type Theme } from "@/lib/theme";
import { setLanguage } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [profileStatus, setProfileStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [avatarStatus, setAvatarStatus] = useState<"idle" | "uploading" | "saved" | "error">(
    "idle",
  );

  useEffect(() => {
    if (!me) {
      return;
    }
    setName(me.name ?? "");
    setNickname(me.nickname ?? "");
  }, [me?.id]);

  async function saveProfile() {
    setProfileStatus("saving");
    try {
      await api.users.updateProfile({
        name: name.trim() || undefined,
        nickname: nickname.trim() ? nickname.trim() : null,
      });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      setProfileStatus("saved");
    } catch {
      setProfileStatus("error");
    }
  }

  async function uploadAvatar(file: File) {
    setAvatarStatus("uploading");
    try {
      await api.users.uploadAvatar(file);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      setAvatarStatus("saved");
    } catch {
      setAvatarStatus("error");
    }
  }

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
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center gap-3">
            {me?.avatarUrl ? (
              <img src={me.avatarUrl} alt="" className="size-12 rounded-full object-cover" />
            ) : (
              <div className="grid size-12 place-items-center rounded-full bg-muted text-sm font-medium">
                {(me?.nickname ?? me?.name ?? me?.username ?? "?").slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="space-y-1">
              <Button variant="outline" size="sm" render={<label />}>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void uploadAvatar(file);
                    }
                    event.target.value = "";
                  }}
                />
                {t("settings.uploadAvatar")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("settings.avatarHint")}</p>
              {avatarStatus === "saved" && (
                <p className="text-xs text-muted-foreground">{t("settings.avatarUpdated")}</p>
              )}
              {avatarStatus === "error" && (
                <p role="alert" className="text-xs text-destructive">
                  {t("settings.saveFailed")}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground" htmlFor="profile-name">
              {t("settings.displayName")}
            </label>
            <Input
              id="profile-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground" htmlFor="profile-nickname">
              {t("settings.nickname")}
            </label>
            <Input
              id="profile-nickname"
              value={nickname}
              maxLength={80}
              onChange={(event) => setNickname(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => void saveProfile()}
              disabled={profileStatus === "saving"}
            >
              {t("settings.save")}
            </Button>
            {profileStatus === "saved" && (
              <span className="text-xs text-muted-foreground">{t("settings.saved")}</span>
            )}
            {profileStatus === "error" && (
              <span role="alert" className="text-xs text-destructive">
                {t("settings.saveFailed")}
              </span>
            )}
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
