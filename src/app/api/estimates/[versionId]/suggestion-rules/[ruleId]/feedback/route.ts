import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { suggestionRuleFeedbackSchema } from "@/lib/estimates/schemas";
import { saveSuggestionRuleFeedback } from "@/lib/estimates/reference-data-server";
import { parseJsonBody, uuidRouteParams } from "@/lib/http/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string; ruleId: string }> }
) {
  try {
    const { versionId, ruleId } = await uuidRouteParams(params, "versionId", "ruleId");
    const body = suggestionRuleFeedbackSchema.parse(await parseJsonBody(request, badRequest));
    const data = await saveSuggestionRuleFeedback(versionId, ruleId, body);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
