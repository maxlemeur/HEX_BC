import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, toErrorResponse, unauthorized } from "@/lib/estimates/errors";
import { sharedSecretMatches } from "@/lib/http/shared-secret";
import { TakeoffError, TakeoffErrorCode, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import type { TakeoffJobAttemptTrigger } from "@/lib/takeoff/types";

const workerPayloadSchema = z
  .object({
    job_id: z.string().uuid("job_id doit être un UUID valide."),
    correlation_id: z.string().uuid("correlation_id doit être un UUID valide.").optional(),
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

  if (!sharedSecretMatches(providedSecret, expectedSecret)) {
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

    await parseWorkerPayload(request);
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
      message: "Le traitement distant est désactivé. Utilisez le forfait ChatGPT dans MergeOne local." });
  } catch (error) {
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), {
        status: error.status,
      });
    }

    return toErrorResponse(error);
  }
}
