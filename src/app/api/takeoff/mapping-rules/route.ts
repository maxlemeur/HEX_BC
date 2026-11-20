import {
  badRequest,
  ok,
  toErrorResponse,
} from "@/lib/http/api-response";
import { createTakeoffMappingRuleSchema } from "@/lib/takeoff/schemas";
import {
  createTakeoffMappingRule,
  listTakeoffMappingRules,
} from "@/lib/takeoff/server";
import type { CreateTakeoffMappingRuleInput } from "@/lib/takeoff/types";
import { parseJsonBody } from "@/lib/http/request";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";

function parseCreateTakeoffMappingRulePayload(
  payload: unknown
): CreateTakeoffMappingRuleInput {
  return parseWithSchema(createTakeoffMappingRuleSchema, payload, "Payload invalide.");
}

export async function GET(_request: Request) {
  void _request;

  try {
    const data = await listTakeoffMappingRules();
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = parseCreateTakeoffMappingRulePayload(
      await parseJsonBody(request, badRequest)
    );
    const data = await createTakeoffMappingRule(payload);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
