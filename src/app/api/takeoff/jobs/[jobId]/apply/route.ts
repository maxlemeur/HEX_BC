import { parseTakeoffApplyResponse } from "@/lib/takeoff/apply-response-contracts";
import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import { applyTakeoffJob } from "@/lib/takeoff/server";

async function getJobId(paramsPromise: Promise<{ jobId: string }>) {
  return (await paramsPromise).jobId;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const jobId = await getJobId(params);
    const body = await request.json();
    const data = await applyTakeoffJob(jobId, body);
    return ok(parseTakeoffApplyResponse(data, { jobId, targetSectionId: body.target_section_id }));
  } catch (error) {
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), {
        status: error.status,
      });
    }

    return toErrorResponse(error);
  }
}
