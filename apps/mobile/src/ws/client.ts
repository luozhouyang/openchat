import type { ClientFrame } from "protocol";
import { appClient } from "../app-client";
import { getDeviceId } from "../lib/secure";

/**
 * Thin mobile wrapper over the shared realtime connection (P12-D): transport,
 * sync, gap refills and the dispatcher all live in packages/state (connection
 * state is the shared useConnectionStore). Only the mobile lifecycle policy
 * is mobile code: background closes the socket, foreground reconnects and
 * re-syncs (p10 spec §4.1).
 */
let selfUserId: string | null = null;

const connection = appClient.createRealtime({
  selfUserId: () => selfUserId,
});

/** Opens the realtime socket for this device (token from SecureStore). */
export async function connectRealtime(): Promise<void> {
  if (selfUserId === null) {
    try {
      const me = await appClient.api.me();
      selfUserId = me.user.id;
    } catch {
      selfUserId = null;
    }
  }
  await connection.connect(await getDeviceId());
}

/** Closes the socket when the app goes to background (spec §4.1). */
export function closeRealtime(): void {
  connection.close();
}

export function sendFrame(frame: ClientFrame): boolean {
  return connection.send(frame);
}

/** Liveness signal for presence + push suppression (system design §5.5). */
export function sendActivity(): void {
  connection.sendActivity();
}

/** Exposed for tests: the shared server-event pipeline. */
export const dispatch = (raw: string) => connection.dispatch(raw);
