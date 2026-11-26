import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { parseEstimateDraftGenerationBody } from "@/lib/estimates/draft-ai-generation";
import { generateVersionZeroDraftSchema } from "@/lib/estimates/schemas";
import {
  fetchVersionZeroDraftSummary,
  generateVersionZeroDraft,
} from "@/lib/estimates/version-zero-drafts";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

// The database execution lock outlives this request.
export const maxDuration = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const data = await fetchVersionZeroDraftSummary({ versionId });
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
    const body = parseEstimateDraftGenerationBody(
      generateVersionZeroDraftSchema, await parseJsonBody(request, badRequest)
    );
    const data = await generateVersionZeroDraft({
      versionId,
      briefId: body.brief_id ?? null,
      selectedLots: body.selected_lots,
      ai: body.ai,
    });
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
