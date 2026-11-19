import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { suggestionRuleFeedbackSchema } from "@/lib/estimates/schemas";
import { saveSuggestionRuleFeedback } from "@/lib/estimates/server";
import { parseJsonBody } from "@/lib/http/request";

const paramsSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  ruleId: z.string().uuid("ruleId invalide."),
});

async function getParams(
  paramsPromise: Promise<{ versionId: string; ruleId: string }>
) {
  const params = await paramsPromise;
  return paramsSchema.parse(params);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string; ruleId: string }> }
) {
  try {
    const { versionId, ruleId } = await getParams(params);
    const body = suggestionRuleFeedbackSchema.parse(await parseJsonBody(request, badRequest));
    const data = await saveSuggestionRuleFeedback(versionId, ruleId, body);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
