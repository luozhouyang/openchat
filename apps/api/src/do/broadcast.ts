import { userDoName } from "protocol";
import { UserDO } from "./user.ts";

export interface BroadcastDeps {
  env: { USER_DO: DurableObjectNamespace<UserDO>; channelId: string };
  subscribers: () => Iterable<string>;
  onPushFailed: (userId: string) => void;
}

export function createBroadcaster(deps: BroadcastDeps) {
  let buffer: { userId: string; events: unknown[] }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function deliver(userId: string, events: unknown[]) {
    try {
      const id = deps.env.USER_DO.idFromName(userDoName(userId));
      await deps.env.USER_DO.get(id).push({ channelId: deps.env.channelId, events });
    } catch {
      deps.onPushFailed(userId);
    }
  }

  async function flush() {
    const batch = buffer;
    buffer = [];
    timer = null;
    await Promise.all(batch.map((b) => deliver(b.userId, b.events)));
  }

  return {
    async broadcast(event: unknown) {
      const targets = [...deps.subscribers()];
      if (targets.length < 200) {
        await Promise.all(targets.map((userId) => deliver(userId, [event])));
        return;
      }
      for (const userId of targets) {
        let entry = buffer.find((b) => b.userId === userId);
        if (!entry) {
          entry = { userId, events: [] };
          buffer.push(entry);
        }
        entry.events.push(event);
      }
      if (!timer) timer = setTimeout(() => void flush(), 100);
    },
  };
}
