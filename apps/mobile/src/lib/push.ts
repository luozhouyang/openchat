import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./auth";
import { getDeviceId } from "./secure";

/** Deep link (openchat://c/<channelId>) carried by a tapped notification. */
let pendingDeepLink: string | null = null;

export function consumeDeepLink(): string | null {
  const link = pendingDeepLink;
  pendingDeepLink = null;
  return link;
}

/**
 * Push registration (spec §4.3): expo-notifications token → the existing
 * push_subscriptions pipeline. Requires a development build (EAS) with push
 * credentials; in Expo Go or on unsupported targets this degrades to a no-op.
 */
export async function registerPush(): Promise<void> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted;
    if (!granted && settings.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return;

    const token = await Notifications.getDevicePushTokenAsync();
    const nativeToken = "data" in token && typeof token.data === "string" ? token.data : "";
    // The current push pipeline (P7) stores webpush endpoints; native tokens
    // are carried via the Expo push service endpoint until the API grows
    // fcm/apns token columns (P10c backend follow-up).
    await api("/api/v1/users/me/push_subscriptions", {
      method: "POST",
      body: JSON.stringify({
        deviceId: await getDeviceId(),
        kind: Platform.OS === "ios" ? "apns" : "fcm",
        endpoint: `https://exp.host/--/api/v2/push/send?device=${encodeURIComponent(nativeToken)}`,
      }),
    });

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "messages",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    // Notification tap → in-app deep link (openchat://c/<channelId>).
    Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === "string") pendingDeepLink = url;
    });
  } catch {
    // Push is best-effort; chat must work without it.
  }
}
