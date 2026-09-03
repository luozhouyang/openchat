import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [status, setStatus] = useState(Notification.permission);

  async function enablePush() {
    const permission = await Notification.requestPermission();
    setStatus(permission);
    if (permission !== "granted") return;
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
  }

  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="mb-4 text-xl font-semibold">设置</h1>
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded border p-4">
          <div>
            <p className="font-medium">桌面推送通知</p>
            <p className="text-sm text-zinc-500">当前状态：{status}</p>
          </div>
          <Button onClick={enablePush} disabled={status === "granted"}>
            开启
          </Button>
        </div>
      </div>
    </div>
  );
}
