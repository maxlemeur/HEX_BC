import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { generateVersionZeroDraftSchema } from "@/lib/estimates/schemas";
import {
  fetchVersionZeroDraftSummary,
  generateVersionZeroDraft,
} from "@/lib/estimates/version-zero-drafts";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

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
    const body = generateVersionZeroDraftSchema.parse(await parseJsonBody(request, badRequest));
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
