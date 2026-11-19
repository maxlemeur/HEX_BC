import { parseTakeoffJobActionResponse } from "@/lib/takeoff/job-response-contracts";
import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/http/api-response";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
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
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), {
        status: error.status,
      });
    }

    return toErrorResponse(error);
  }
}
