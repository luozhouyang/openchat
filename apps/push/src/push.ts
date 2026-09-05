import webpush from "web-push";

interface PushEnv {
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  API_BASE: string;
  INTERNAL_TOKEN_KEY: string;
}

interface PushTask {
  type: "push-notification";
  userId: string;
  channelId: string;
  messageId: string;
  title: string;
  body: string;
  createdAt: number;
}

interface Subscription {
  deviceId: string;
  kind: string;
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
}

export async function handlePushTask(task: PushTask, env: PushEnv): Promise<void> {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const subs = await fetchSubscriptions(env, task.userId);
  const payload = JSON.stringify({
    title: task.title,
    body: task.body,
    channelId: task.channelId,
    messageId: task.messageId,
  });

  for (const sub of subs) {
    if (sub.kind === "webpush") {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh ?? "", auth: sub.auth ?? "" } },
          payload,
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await unregister(env, task.userId, sub.deviceId);
        } else {
          throw err;
        }
      }
    } else if (sub.kind === "expo") {
      // Mobile: the Expo push service fans out to FCM/APNs on our behalf (no
      // per-provider credentials to manage in the worker).
      await sendExpo(sub, payload);
    }
    // "fcm" / "apns": direct provider delivery needs an OAuth2 service
    // account / APNs credentials design decision — not implemented yet;
    // mobile registers as kind=expo instead.
  }
}

async function sendExpo(sub: Subscription, payload: string): Promise<void> {
  const token = new URL(sub.endpoint).searchParams.get("device");
  if (!token) {
    console.error("expo push: endpoint carries no device token");
    return;
  }
  const data = JSON.parse(payload) as { title: string; body: string; channelId: string };
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      {
        to: token,
        title: data.title,
        body: data.body,
        data: { url: `openchat://c/${data.channelId}` },
      },
    ]),
  });
  if (!res.ok) {
    console.error("expo push failed", res.status);
  }
}

async function fetchSubscriptions(env: PushEnv, userId: string): Promise<Subscription[]> {
  const res = await fetch(`${env.API_BASE}/internal/push-user/${userId}/subscriptions`, {
    headers: { "x-internal-token": env.INTERNAL_TOKEN_KEY },
  });
  if (!res.ok) {
    return [];
  }
  const body = (await res.json()) as { subscriptions: Subscription[] };
  return body.subscriptions;
}

async function unregister(env: PushEnv, userId: string, deviceId: string): Promise<void> {
  await fetch(`${env.API_BASE}/internal/push-user/${userId}/subscriptions`, {
    method: "DELETE",
    headers: { "x-internal-token": env.INTERNAL_TOKEN_KEY, "content-type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
}
