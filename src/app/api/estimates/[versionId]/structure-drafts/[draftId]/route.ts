import { ok, toErrorResponse } from "@/lib/http/api-response";
import { uuidRouteParams } from "@/lib/http/request";
import { getEstimateStructureDraft } from "@/lib/estimates/structure-drafts";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string; draftId: string }> }
) {
  try {
    const { versionId, draftId } = await uuidRouteParams(params, "versionId", "draftId");
    const data = await getEstimateStructureDraft(versionId, draftId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
