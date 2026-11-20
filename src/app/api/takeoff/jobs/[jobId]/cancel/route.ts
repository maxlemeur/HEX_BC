import { parseTakeoffJobActionResponse } from "@/lib/takeoff/job-response-contracts";

import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { cancelTakeoffJob } from "@/lib/takeoff/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  void _request;

  try {
    const jobId = (await params).jobId;
    const data = await cancelTakeoffJob(jobId);
    return ok(parseTakeoffJobActionResponse(data, { jobId, command: "cancel" }));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
