import { expect, test } from "vite-plus/test";
import worker from "../src/index.ts";

test("queue handler consumes messages without throwing", async () => {
  const batch = {
    queue: "openchat-push",
    messages: [{ id: "m1", body: { kind: "test" }, attempts: 1 }],
  } as unknown as MessageBatch<unknown>;
  await expect(worker.queue(batch)).resolves.toBeUndefined();
});
