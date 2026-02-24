import { z } from "zod";

import {
  badRequest,
  ok,
  toErrorResponse,
  unprocessableEntity,
} from "@/lib/estimates/errors";
import {
  takeoffMappingRuleIdSchema,
  updateTakeoffMappingRuleSchema,
} from "@/lib/takeoff/schemas";
import {
  deleteTakeoffMappingRule,
  updateTakeoffMappingRule,
} from "@/lib/takeoff/server";
import type { UpdateTakeoffMappingRuleInput } from "@/lib/takeoff/types";

const paramsSchema = z.object({
  ruleId: takeoffMappingRuleIdSchema,
});

function toValidationIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

function parseUpdateTakeoffMappingRulePayload(
  payload: unknown
): UpdateTakeoffMappingRuleInput {
  const parsed = updateTakeoffMappingRuleSchema.safeParse(payload);

  if (!parsed.success) {
    throw unprocessableEntity(
      "Payload invalide.",
      {
        issues: toValidationIssues(parsed.error),
      },
      "VALIDATION_ERROR"
    );
  }

  return parsed.data;
}

async function getRuleId(paramsPromise: Promise<{ ruleId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).ruleId;
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  try {
    const ruleId = await getRuleId(params);
    const payload = parseUpdateTakeoffMappingRulePayload(
      await parseJsonBody(request)
    );
    const data = await updateTakeoffMappingRule(ruleId, payload);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  try {
    const ruleId = await getRuleId(params);
    const data = await deleteTakeoffMappingRule(ruleId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
