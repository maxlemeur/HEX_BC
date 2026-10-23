import { z } from "zod";

import { unprocessableEntity } from "@/lib/estimates/errors";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
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

export const TAKEOFF_TENANT_ADMIN_ROLE = "admin";

export const TAKEOFF_TENANT_ENGINEER_ROLE = "engineer";

const TAKEOFF_OPERATOR_ALLOWED_ROLES = new Set([
  TAKEOFF_TENANT_ADMIN_ROLE,
  TAKEOFF_TENANT_ENGINEER_ROLE,
]);

export function assertTakeoffOperatorActionRole(tenantRole: string | null | undefined) {
  if (tenantRole && TAKEOFF_OPERATOR_ALLOWED_ROLES.has(tenantRole)) {
    return;
  }

  throw new TakeoffError({
    status: 403,
    code: TakeoffErrorCode.FORBIDDEN,
    message: "Accès refusé.",
    retryable: false,
  });
}
