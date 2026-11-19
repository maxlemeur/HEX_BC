import { ok, toErrorResponse } from "@/lib/http/api-response";
import { getEstimateApprovalSummary } from "@/lib/estimates/rules-engine";
import { uuidRouteParam } from "@/lib/http/request";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const summary = await getEstimateApprovalSummary(versionId);
    return ok(summary);
  } catch (error) {
    return toErrorResponse(error);
  }
}
