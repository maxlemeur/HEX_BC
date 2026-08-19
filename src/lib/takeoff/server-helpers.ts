import { z } from "zod";

import { unprocessableEntity } from "@/lib/estimates/errors";
import { toValidationIssues } from "@/lib/takeoff/validation-issues";

export { toValidationIssues } from "@/lib/takeoff/validation-issues";

export function parseWithSchema<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  message: string
): T {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw unprocessableEntity(
      message,
      {
        issues: toValidationIssues(parsed.error),
      },
      "VALIDATION_ERROR"
    );
  }

  return parsed.data;
}
