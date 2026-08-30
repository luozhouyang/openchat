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
    } else if (sub.kind === "fcm") {
      await sendFcm(env, sub, payload);
    }
  }
}

async function fetchSubscriptions(env: PushEnv, userId: string): Promise<Subscription[]> {
  const res = await fetch(`${env.API_BASE}/internal/push-user/${userId}/subscriptions`, {
    headers: { "x-internal-token": env.INTERNAL_TOKEN_KEY },
  });
  if (!res.ok) return [];
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

async function sendFcm(_env: PushEnv, sub: Subscription, payload: string): Promise<void> {
  const res = await fetch("https://fcm.googleapis.com/v1/projects/openchat/messages:send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: { token: sub.endpoint, data: { payload } },
    }),
  });
  if (!res.ok) console.error("fcm push failed", res.status);
}
