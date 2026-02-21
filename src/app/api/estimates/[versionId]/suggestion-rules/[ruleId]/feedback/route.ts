import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { suggestionRuleFeedbackSchema } from "@/lib/estimates/schemas";
import { saveSuggestionRuleFeedback } from "@/lib/estimates/server";

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

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string; ruleId: string }> }
) {
  try {
    const { versionId, ruleId } = await getParams(params);
    const body = suggestionRuleFeedbackSchema.parse(await parseJsonBody(request));
    const data = await saveSuggestionRuleFeedback(versionId, ruleId, body);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
