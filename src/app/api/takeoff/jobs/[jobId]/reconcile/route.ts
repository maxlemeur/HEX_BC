import { parseTakeoffJobActionResponse } from "@/lib/takeoff/job-response-contracts";
import { NextResponse } from "next/server";

import { ok, toErrorResponse } from "@/lib/http/api-response";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import {
  TakeoffError,
  toTakeoffErrorResponse,
} from "@/lib/takeoff/errors";
import { reconcileTakeoffJobNow } from "@/lib/takeoff/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  void _request;

  try {
    const jobId = (await params).jobId;
    const data = await reconcileTakeoffJobNow(jobId);
    let dispatch:
      | {
          status: "accepted" | "queued_for_recovery" | "persistence_unconfirmed";
          correlation_id: string;
          persisted: boolean;
        }
      | undefined;

    if (data.outcome === "applied") {
      const triggerResult = await triggerTakeoffJobProcessing({
        jobId: data.job.id,
        trigger: "reconcile",
      });
      const dispatchPersisted = await persistTakeoffDispatchOutcome({
        jobId: data.job.id,
        trigger: "reconcile",
        result: triggerResult,
      });

      if (!triggerResult.triggered) {
        console.error("Takeoff reconcile accepted but async processing trigger failed.", {
          jobId: data.job.id,
          correlationId: triggerResult.correlationId,
        });
      }

      dispatch = {
        status: triggerResult.triggered
          ? "accepted"
          : dispatchPersisted
            ? "queued_for_recovery"
            : "persistence_unconfirmed",
        correlation_id: triggerResult.correlationId,
        persisted: dispatchPersisted,
      };
    }

    return ok(parseTakeoffJobActionResponse({ ...data, ...(dispatch ? { dispatch } : {}) }, { jobId, command: "reconcile" }));
  } catch (error) {
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), {
        status: error.status,
      });
    }

    return toErrorResponse(error);
  }
}
