import { parseSaveTakeoffDpgfManualLinkResponse } from "@/lib/takeoff/review-response-contracts";
import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/http/api-response";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import { saveTakeoffDpgfManualLink } from "@/lib/takeoff/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const jobId = (await params).jobId;
    const body = await request.json();
    const data = await saveTakeoffDpgfManualLink(jobId, body);

    return ok(parseSaveTakeoffDpgfManualLinkResponse(data, { jobId, versionId: body.version_id, lineId: body.estimate_item_id, itemIds: body.takeoff_item_ids ?? [] }));
  } catch (error) {
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), {
        status: error.status,
      });
    }

    return toErrorResponse(error);
  }
}
