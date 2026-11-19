import { parseVerifyEstimateSealResponse } from "@/lib/estimates/write-response-contracts";
import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";

import { ok, toErrorResponse } from "@/lib/http/api-response";
import { verifyEstimateSeal } from "@/lib/estimates/server";
import { uuidRouteParam } from "@/lib/http/request";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const data = await verifyEstimateSeal(versionId);
    return ok(validateEstimateResponse(() => parseVerifyEstimateSealResponse(data)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
