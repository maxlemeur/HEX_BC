import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import { resubmitTakeoffJob } from "@/lib/takeoff/server";

async function getJobId(paramsPromise: Promise<{ jobId: string }>) {
  return (await paramsPromise).jobId;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  void _request;

  try {
    const jobId = await getJobId(params);
    const data = await resubmitTakeoffJob(jobId);

    if (data.outcome === "applied") {
      const triggerResult = await triggerTakeoffJobProcessing({
        jobId: data.job.id,
        trigger: "retry",
      });

      if (!triggerResult.triggered) {
        console.error(
          "Takeoff resubmit accepted but async processing trigger failed.",
          {
            jobId: data.job.id,
            correlationId: triggerResult.correlationId,
          }
        );
      }
    }

    return ok(data);
  } catch (error) {
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), {
        status: error.status,
      });
    }

    return toErrorResponse(error);
  }
}
