import { parseEstimateEventsResponse } from "@/lib/estimates/write-response-contracts";
import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";

import { ok, toErrorResponse } from "@/lib/http/api-response";
import { listEstimateVersionEvents } from "@/lib/estimates/version-read-server";
import { uuidRouteParam } from "@/lib/http/request";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const data = await listEstimateVersionEvents(versionId);
    return ok(validateEstimateResponse(() => parseEstimateEventsResponse(data, versionId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
