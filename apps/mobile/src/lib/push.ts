import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { appClient } from "../app-client";
import { getDeviceId } from "./secure";

/** Deep link (openchat://c/<channelId>) carried by a tapped notification. */
let pendingDeepLink: string | null = null;

export function consumeDeepLink(): string | null {
  const link = pendingDeepLink;
  pendingDeepLink = null;
  return link;
}

/**
 * Push registration (spec §4.3): an Expo push token registered as kind=expo;
 * the push worker delivers through the Expo push service, which fans out to
 * FCM/APNs. Requires a development build (EAS) — in Expo Go or on unsupported
 * targets this degrades to a no-op.
 */
export async function registerPush(): Promise<void> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted;
    if (!granted && settings.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) {
      return;
    }

    const { data: expoToken } = await Notifications.getExpoPushTokenAsync();
    if (typeof expoToken !== "string" || expoToken.length === 0) {
      return;
    }
    // endpoint must be a URL (protocol PushSubscribeInput); the Expo push
    // service send endpoint carries the token in the device query param.
    const endpoint = `https://exp.host/--/api/v2/push/send?device=${encodeURIComponent(expoToken)}`;
    await appClient.api.push.subscribe({
      deviceId: await getDeviceId(),
      kind: "expo",
      endpoint,
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
      if (typeof url === "string") {
        pendingDeepLink = url;
      }
    });
  } catch {
    // Push is best-effort; chat must work without it.
  }
}
