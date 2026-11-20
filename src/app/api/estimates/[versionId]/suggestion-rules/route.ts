import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { createSuggestionRuleSchema } from "@/lib/estimates/schemas";
import { createSuggestionRule } from "@/lib/estimates/server";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const body = createSuggestionRuleSchema.parse(await parseJsonBody(request, badRequest));
    const data = await createSuggestionRule(versionId, body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
