import { parseSaveTakeoffReviewDecisionResponse } from "@/lib/takeoff/review-response-contracts";

import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { saveTakeoffReviewDecision } from "@/lib/takeoff/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const jobId = (await params).jobId;
    const body = await request.json();
    const data = await saveTakeoffReviewDecision(jobId, body);

    return ok(parseSaveTakeoffReviewDecisionResponse(data, { jobId, versionId: body.version_id, lineId: body.estimate_item_id, decision: body.decision, reason: body.reason }));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
