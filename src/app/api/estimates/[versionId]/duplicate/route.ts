import { parseEstimateVersionIdResponse } from "@/lib/estimates/write-response-contracts";
import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";

import { ok, toErrorResponse } from "@/lib/http/api-response";
import { duplicateEstimateVersion } from "@/lib/estimates/version-variant-server";
import { uuidRouteParam } from "@/lib/http/request";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const data = await duplicateEstimateVersion(versionId);
    return ok(validateEstimateResponse(() => parseEstimateVersionIdResponse(data, versionId)), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
