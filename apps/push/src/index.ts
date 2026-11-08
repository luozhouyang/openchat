import { handleR2Event, fromR2Notification } from "./thumbnail.ts";
import { handlePushTask } from "./push.ts";

export default {
  async queue(batch: MessageBatch<unknown>, env?: Env): Promise<void> {
    for (const message of batch.messages) {
      const body = message.body as {
        type?: string;
        event?: { key: string; contentType?: string; size: number };
      };
      // R2 event-notification envelope (bucket notification rule points the
      // openchat-files queue consumer here).
      const r2Event = fromR2Notification(message.body);
      if (r2Event) {
        await handleR2Event(r2Event, env as Env);
      } else if (body.type === "r2-thumbnail" && body.event) {
        await handleR2Event(body.event, env as Env);
      } else if (body.type === "push-notification") {
        await handlePushTask(message.body as never, env as never);
      } else {
        console.log("push message", message.id, message.body);
      }
    }
  },
};
