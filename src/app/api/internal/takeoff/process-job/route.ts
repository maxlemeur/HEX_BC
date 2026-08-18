import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, ok, toErrorResponse, unauthorized } from "@/lib/estimates/errors";
import { processTakeoffJobAttempt } from "@/lib/takeoff/async-worker";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import type { TakeoffJobAttemptTrigger } from "@/lib/takeoff/types";

const workerPayloadSchema = z
  .object({
    job_id: z.string().uuid("job_id doit etre un UUID valide."),
    correlation_id: z.string().uuid("correlation_id doit etre un UUID valide.").optional(),
    trigger: z.enum(["create", "retry", "manual", "reconcile"]).optional(),
  })
  .strict();

function getWorkerSecret() {
  const configured = process.env.TAKEOFF_WORKER_SECRET;
  if (configured && configured.trim().length > 0) {
    return configured;
  }

  if (process.env.NODE_ENV === "test") {
    return "test-worker-secret";
  }

  throw new Error("Missing TAKEOFF_WORKER_SECRET for internal takeoff worker route.");
}

function assertWorkerSecret(request: Request) {
  const providedSecret = request.headers.get("x-takeoff-worker-secret");
  const expectedSecret = getWorkerSecret();

  if (!providedSecret || providedSecret !== expectedSecret) {
    throw unauthorized("Unauthorized takeoff worker request.");
  }
}

async function parseWorkerPayload(request: Request): Promise<{
  jobId: string;
  correlationId: string;
  trigger: TakeoffJobAttemptTrigger;
}> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }

  const parsed = workerPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw badRequest("Payload worker takeoff invalide.", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const correlationFromHeader = request.headers.get("x-correlation-id");
  const parsedHeaderCorrelation = z.string().uuid().safeParse(correlationFromHeader);

  return {
    jobId: parsed.data.job_id,
    correlationId:
      parsed.data.correlation_id ??
      (parsedHeaderCorrelation.success
        ? parsedHeaderCorrelation.data
        : crypto.randomUUID()),
    trigger: parsed.data.trigger ?? "manual",
  };
}

export async function POST(request: Request) {
  try {
    assertWorkerSecret(request);

    const payload = await parseWorkerPayload(request);
    await persistTakeoffDispatchOutcome({
      jobId: payload.jobId,
      trigger: payload.trigger,
      result: {
        triggered: true,
        correlationId: payload.correlationId,
        statusCode: null,
        outcome: "accepted",
      },
    });
    const outcome = await processTakeoffJobAttempt(payload.jobId, {
      correlationId: payload.correlationId,
      trigger: payload.trigger,
    });

    const status = outcome.should_requeue || outcome.status === "in_progress" ? 202 : 200;
    return ok(outcome, status);
  } catch (error) {
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), {
        status: error.status,
      });
    }

    return toErrorResponse(error);
  }
}
