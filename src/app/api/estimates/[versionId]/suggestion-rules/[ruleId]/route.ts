import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { updateSuggestionRuleSchema } from "@/lib/estimates/schemas";
import { updateSuggestionRule } from "@/lib/estimates/reference-data-server";
import { parseJsonBody, uuidRouteParams } from "@/lib/http/request";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ versionId: string; ruleId: string }> }
) {
  try {
    const { versionId, ruleId } = await uuidRouteParams(params, "versionId", "ruleId");
    const body = updateSuggestionRuleSchema.parse(await parseJsonBody(request, badRequest));
    const data = await updateSuggestionRule(versionId, ruleId, body);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
