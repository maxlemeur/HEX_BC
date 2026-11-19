import { z } from "zod";

import {
  badRequest,
  ok,
  toErrorResponse,
} from "@/lib/http/api-response";
import {
  takeoffMappingRuleIdSchema,
  updateTakeoffMappingRuleSchema,
} from "@/lib/takeoff/schemas";
import {
  deleteTakeoffMappingRule,
  updateTakeoffMappingRule,
} from "@/lib/takeoff/server";
import type { UpdateTakeoffMappingRuleInput } from "@/lib/takeoff/types";
import { parseJsonBody } from "@/lib/http/request";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";

const paramsSchema = z.object({
  ruleId: takeoffMappingRuleIdSchema,
});

function parseUpdateTakeoffMappingRulePayload(
  payload: unknown
): UpdateTakeoffMappingRuleInput {
  return parseWithSchema(updateTakeoffMappingRuleSchema, payload, "Payload invalide.");
}

async function getRuleId(paramsPromise: Promise<{ ruleId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).ruleId;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  try {
    const ruleId = await getRuleId(params);
    const payload = parseUpdateTakeoffMappingRulePayload(
      await parseJsonBody(request, badRequest)
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
