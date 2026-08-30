import { handleR2Event } from "./thumbnail.ts";

export default {
  async queue(batch: MessageBatch<unknown>, env?: Env): Promise<void> {
    for (const message of batch.messages) {
      const body = message.body as {
        type?: string;
        event?: { key: string; contentType?: string; size: number };
      };
      if (body.type === "r2-thumbnail" && body.event) {
        await handleR2Event(body.event, env as Env);
      } else {
        console.log("push message", message.id, message.body);
      }
    }
  },
};
