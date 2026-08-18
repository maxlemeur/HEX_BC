import { NextResponse } from "next/server";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";
import { TakeoffError, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import {
  createTakeoffJobFromFormData,
  listTakeoffJobs,
  parseListTakeoffJobsQuery,
} from "@/lib/takeoff/server";

async function parseMultipartFormData(request: Request) {
  try {
    return await request.formData();
  } catch {
    throw badRequest("Payload multipart invalide.");
  }
}

function toQueryObject(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

export async function GET(request: Request) {
  try {
    const query = parseListTakeoffJobsQuery(toQueryObject(request));
    const data = await listTakeoffJobs(query);
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

export async function POST(request: Request) {
  try {
    const formData = await parseMultipartFormData(request);
    const data = await createTakeoffJobFromFormData(formData, {
      idempotencyKey: request.headers.get("idempotency-key"),
    });

    const triggerResult = await triggerTakeoffJobProcessing({
      jobId: data.id,
      trigger: "create",
    });
    const dispatchPersisted = await persistTakeoffDispatchOutcome({
      jobId: data.id,
      trigger: "create",
      result: triggerResult,
    });

    if (!triggerResult.triggered) {
      console.error("Takeoff job created but async processing trigger failed.", {
        jobId: data.id,
        correlationId: triggerResult.correlationId,
      });
    }

    return ok(
      {
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
      },
      201
    );
  } catch (error) {
    if (error instanceof TakeoffError) {
      return NextResponse.json(toTakeoffErrorResponse(error), {
        status: error.status,
      });
    }

    return toErrorResponse(error);
  }
}
