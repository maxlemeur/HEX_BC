import { ok, toErrorResponse } from "@/lib/http/api-response";
import { uuidRouteParams } from "@/lib/http/request";
import { fetchVersionZeroReview } from "@/lib/estimates/version-zero-drafts";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string; draftId: string }> }
) {
  try {
    const { versionId, draftId } = await uuidRouteParams(params, "versionId", "draftId");
    const data = await fetchVersionZeroReview({ versionId, draftId });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
