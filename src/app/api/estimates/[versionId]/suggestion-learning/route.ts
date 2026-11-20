import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { trackSuggestionCorrectionsSchema } from "@/lib/estimates/schemas";
import { getLearnings, trackCorrection } from "@/lib/estimates/suggestion-learning";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const data = await getLearnings({
      versionId,
      includeInactive: false,
    });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const body = trackSuggestionCorrectionsSchema.parse(await parseJsonBody(request, badRequest));
    const data = await trackCorrection({
      versionId,
      corrections: body.corrections.map((correction) => ({
        rule_id: correction.rule_id,
        field_name: correction.field_name,
        original_value: correction.original_value ?? null,
        corrected_value: correction.corrected_value ?? null,
        item_title: correction.item_title,
      })),
    });

    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
