import { parseSaveTakeoffDpgfManualLinkResponse } from "@/lib/takeoff/review-response-contracts";

import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
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
    return toTakeoffRouteErrorResponse(error);
  }
}
