import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffErrorResponse,
} from "@/lib/takeoff/errors";
import { reconcileTakeoffJobNow } from "@/lib/takeoff/server";

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
    const data = await reconcileTakeoffJobNow(jobId);

    if (data.outcome === "applied") {
      const triggerResult = await triggerTakeoffJobProcessing({
        jobId: data.job.id,
        trigger: "reconcile",
      });

      if (!triggerResult.triggered) {
        throw new TakeoffError({
          status: 503,
          code: TakeoffErrorCode.INTERNAL_ERROR,
          message: "Le worker async takeoff n'a pas pu etre declenche.",
          details: {
            action: "reconcile",
            correlation_id: triggerResult.correlationId,
            status_code: triggerResult.statusCode,
          },
          retryable: true,
          jobId: data.job.id,
        });
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
