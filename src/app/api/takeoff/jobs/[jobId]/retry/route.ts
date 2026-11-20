import { parseTakeoffJobActionResponse } from "@/lib/takeoff/job-response-contracts";
import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/http/api-response";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import { retryTakeoffJob } from "@/lib/takeoff/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  void _request;

  try {
    const jobId = (await params).jobId;
    const data = await retryTakeoffJob(jobId);

    const triggerResult = await triggerTakeoffJobProcessing({
      jobId: data.job.id,
      trigger: "retry",
    });
    const dispatchPersisted = await persistTakeoffDispatchOutcome({
      jobId: data.job.id,
      trigger: "retry",
      result: triggerResult,
    });

    if (!triggerResult.triggered) {
      console.error("Takeoff retry accepted but async processing trigger failed.", {
        jobId: data.job.id,
        correlationId: triggerResult.correlationId,
      });
    }

    return ok(parseTakeoffJobActionResponse({
      ...data,
      dispatch: {
        status: triggerResult.triggered
          ? "accepted"
          : dispatchPersisted
            ? "queued_for_recovery"
            : "persistence_unconfirmed",
        correlation_id: triggerResult.correlationId,
        persisted: dispatchPersisted,
      },
    }, { jobId, command: "retry" }));
  } catch (error) {
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), {
        status: error.status,
      });
    }

    return toErrorResponse(error);
  }
}
