import { parseTakeoffApplyResponse } from "@/lib/takeoff/apply-response-contracts";

import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { applyTakeoffJob } from "@/lib/takeoff/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const jobId = (await params).jobId;
    const body = await request.json();
    const data = await applyTakeoffJob(jobId, body);
    return ok(parseTakeoffApplyResponse(data, { jobId, targetSectionId: body.target_section_id }));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
