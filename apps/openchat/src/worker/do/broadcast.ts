import { userDoName } from "protocol";
import { UserDO } from "./user.ts";

export interface BroadcastDeps {
  env: { USER_DO: DurableObjectNamespace<UserDO>; channelId: string };
  onPushFailed: (userId: string) => void;
}

export function createBroadcaster(deps: BroadcastDeps) {
  let buffer: { userId: string; events: unknown[]; pref?: "all" | "mention" | "none" }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function deliver(userId: string, events: unknown[], pref?: "all" | "mention" | "none") {
    try {
      const id = deps.env.USER_DO.idFromName(userDoName(userId));
      await deps.env.USER_DO.get(id).push({
        channelId: deps.env.channelId,
        events,
        notifPref: pref,
      });
    } catch {
      deps.onPushFailed(userId);
    }
  }

  async function flush() {
    const batch = buffer;
    buffer = [];
    timer = null;
    await Promise.all(batch.map((b) => deliver(b.userId, b.events, b.pref)));
  }

  return {
    async broadcast(
      event: unknown,
      prefs?: Map<string, "all" | "mention" | "none">,
      targets: Iterable<string> = [],
    ) {
      const list = [...targets];
      if (list.length < 200) {
        await Promise.all(list.map((userId) => deliver(userId, [event], prefs?.get(userId))));
        return;
      }
      for (const userId of list) {
        let entry = buffer.find((b) => b.userId === userId);
        if (!entry) {
          entry = { userId, events: [], pref: prefs?.get(userId) };
          buffer.push(entry);
        }
        entry.events.push(event);
      }
      if (!timer) timer = setTimeout(() => void flush(), 100);
    },
  };
}
