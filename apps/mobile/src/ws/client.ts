import { RealtimeClient } from "realtime";
import { buildSyncChannels, createDispatcher, createSyncGapHandler } from "state";
import type { ClientFrame, Message } from "protocol";
import { api, getWsJwt } from "../lib/auth";
import { getMessageDB } from "../lib/message-db";
import { getDeviceId } from "../lib/secure";
import { createMobilePlatform } from "../platform";

export type ConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

let connectionState: ConnectionState = "idle";
const stateListeners = new Set<(s: ConnectionState) => void>();

export function onConnectionState(cb: (s: ConnectionState) => void): () => void {
  stateListeners.add(cb);
  cb(connectionState);
  return () => stateListeners.delete(cb);
}

function setConnectionState(s: ConnectionState) {
  connectionState = s;
  for (const cb of stateListeners) cb(s);
}

const platform = createMobilePlatform();

const handleSyncGap = createSyncGapHandler({
  getDb: () => getMessageDB(),
  fetchHistory: async (channelId, beforeSeq) => {
    const res = await api<{ messages: Message[] }>(
      `/api/v1/channels/${channelId}/posts?limit=100${beforeSeq !== undefined ? `&beforeSeq=${beforeSeq}` : ""}`,
    );
    return res.messages;
  },
});

/** Shared server-event pipeline (store + on-device DB), same code as web. */
export const dispatch = createDispatcher({
  getDb: () => getMessageDB(),
  onSyncGap: (channelId) => void handleSyncGap(channelId),
});

const realtime = new RealtimeClient({
  getToken: () => getWsJwt(), // replaced by the shared auth service in P12-C
  buildUrl: (deviceId, token) => `${platform.wsUrl}?deviceId=${deviceId}&token=${token}`,
  // Token gone (signed out): RealtimeClient parks itself in "closed"; the
  // login flow reconnects via connectRealtime() after a fresh sign-in.
  onAuthMissing: () => {},
  handlers: {
    onOpen: () => void sendSync(),
    onMessage: (raw) => dispatch(raw),
    onStateChange: setConnectionState,
  },
});

/** Opens the realtime socket for this device (token from SecureStore). */
export async function connectRealtime(): Promise<void> {
  await realtime.connect(await getDeviceId());
}

/** Closes the socket when the app goes to background (spec §4.1). */
export function closeRealtime(): void {
  realtime.close();
}

export function sendFrame(frame: ClientFrame): boolean {
  return realtime.send(JSON.stringify(frame));
}

/** Liveness signal for presence + push suppression (system design §5.5). */
export function sendActivity(): void {
  sendFrame({ type: "activity" });
}

async function sendSync() {
  const db = await getMessageDB();
  const channels = await buildSyncChannels(db);
  if (channels.length === 0) return;
  sendFrame({ type: "sync", channels });
}
