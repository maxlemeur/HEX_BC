import { ok, toErrorResponse } from "@/lib/http/api-response";
import { listEstimateProjectDraftVersions } from "@/lib/estimates/version-list-server";
import { uuidRouteParam } from "@/lib/http/request";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const data = await listEstimateProjectDraftVersions(versionId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
