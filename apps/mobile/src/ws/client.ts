import { RealtimeClient } from "realtime";
import type { ChannelEvent, ClientFrame, Message, ServerEvent } from "protocol";
import { persistEdit, persistMessage, persistMessages, persistRemove } from "../lib/message-db";
import { getDeviceId } from "../lib/secure";
import { createMobilePlatform } from "../platform";
import { useMessages } from "../stores/messages";

export type ConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

let connectionState: ConnectionState = "idle";
const stateListeners = new Set<(s: ConnectionState) => void>();
const localHandlers = new Set<(ev: ServerEvent) => void>();

export function onConnectionState(cb: (s: ConnectionState) => void): () => void {
  stateListeners.add(cb);
  cb(connectionState);
  return () => stateListeners.delete(cb);
}

export function onLocalEvent(cb: (ev: ServerEvent) => void): () => void {
  localHandlers.add(cb);
  return () => localHandlers.delete(cb);
}

function setConnectionState(s: ConnectionState) {
  connectionState = s;
  for (const cb of stateListeners) cb(s);
}

const platform = createMobilePlatform();

const realtime = new RealtimeClient({
  getToken: () => platform.getAuthToken(),
  buildUrl: (deviceId, token) => `${platform.serverUrl}?deviceId=${deviceId}&token=${token}`,
  onAuthMissing: () => {
    for (const cb of localHandlers) {
      cb({ type: "error", code: "auth_missing", message: "authentication required" });
    }
  },
  handlers: {
    onOpen: () => sendSync(),
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

function sendSync() {
  const channels = Object.keys(useMessages.getState().channels);
  if (channels.length === 0) return;
  sendFrame({
    type: "sync",
    channels: channels.map((channelId) => ({
      channelId,
      lastSeq: useMessages.getState().maxSeq(channelId),
    })),
  });
}

export function dispatch(raw: string) {
  const ev = JSON.parse(raw) as ServerEvent;
  switch (ev.type) {
    case "channel.event": {
      const inner = ev.event as ChannelEvent;
      if (inner.type === "message.new" || inner.type === "thread.reply") {
        const message = (inner as { message: Message }).message;
        useMessages.getState().ingest(ev.channelId, message);
        void persistMessage(ev.channelId, message);
      } else if (inner.type === "message.edit") {
        useMessages.getState().edit(ev.channelId, inner.messageId, inner.content, inner.editedAt);
        void persistEdit(ev.channelId, inner.messageId, inner.content, inner.editedAt);
      } else if (inner.type === "message.delete") {
        useMessages.getState().remove(ev.channelId, inner.messageId);
        void persistRemove(ev.channelId, inner.messageId);
      }
      break;
    }
    case "sync.result":
      useMessages.getState().applySync(ev.channelId, ev.messages);
      void persistMessages(ev.channelId, ev.messages);
      for (const cb of localHandlers) cb(ev);
      break;
    case "ack":
      useMessages.getState().ack(ev.channelId, ev.clientToken, { id: ev.messageId, seq: ev.seq });
      break;
    case "error":
    case "sync.gap":
    case "hello":
      for (const cb of localHandlers) cb(ev);
      break;
    default:
      break;
  }
}
