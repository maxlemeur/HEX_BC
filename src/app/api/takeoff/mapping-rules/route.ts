import { z } from "zod";

import {
  badRequest,
  ok,
  toErrorResponse,
  unprocessableEntity,
} from "@/lib/estimates/errors";
import { createTakeoffMappingRuleSchema } from "@/lib/takeoff/schemas";
import {
  createTakeoffMappingRule,
  listTakeoffMappingRules,
} from "@/lib/takeoff/server";
import type { CreateTakeoffMappingRuleInput } from "@/lib/takeoff/types";
import { parseJsonBody } from "@/lib/http/request";

function toValidationIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

function parseCreateTakeoffMappingRulePayload(
  payload: unknown
): CreateTakeoffMappingRuleInput {
  const parsed = createTakeoffMappingRuleSchema.safeParse(payload);

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
