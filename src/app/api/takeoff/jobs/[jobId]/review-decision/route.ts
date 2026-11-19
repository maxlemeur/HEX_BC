import { parseSaveTakeoffReviewDecisionResponse } from "@/lib/takeoff/review-response-contracts";
import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/http/api-response";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
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
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), {
        status: error.status,
      });
    }

    return toErrorResponse(error);
  }
}
