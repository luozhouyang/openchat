import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";

export function zodValidator(
  target: "json" | "query" | "param" | "header" | "cookie",
  schema: ZodType,
) {
  return zValidator(target, schema, (result, c) => {
    if (result.success) return undefined;
    return c.json(
      {
        error: "invalid input",
        code: "invalid",
        details: JSON.stringify(result.error.issues),
      },
      422,
    );
  });
}
