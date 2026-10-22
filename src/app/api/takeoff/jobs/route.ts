import { NextResponse } from "next/server";

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { MAX_FILE_SIZE_BYTES } from "@/lib/file-validation";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";
import { TakeoffError, TakeoffErrorCode, toTakeoffErrorResponse } from "@/lib/takeoff/errors";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import {
  createTakeoffJobFromFormData,
  listTakeoffJobs,
  parseListTakeoffJobsQuery,
} from "@/lib/takeoff/server";

async function parseMultipartFormData(request: Request) {
  // The file limit is 10 MiB; leave room for multipart fields and headers.
  // Bound the actual stream as Content-Length is optional and untrusted.
  const maxRequestBytes = MAX_FILE_SIZE_BYTES + 1024 * 1024;
  const tooLarge = () => new TakeoffError({
    status: 413,
    code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
    message: "Le formulaire takeoff depasse la taille autorisée.",
    retryable: false,
  });
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
    throw tooLarge();
  }

  const reader = request.body?.getReader();
  if (!reader) throw badRequest("Payload multipart invalide.");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxRequestBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof TakeoffError) throw error;
    throw badRequest("Payload multipart invalide.");
  }

  try {
    const boundedRequest = new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      body: Buffer.concat(chunks),
    });
    return await boundedRequest.formData();
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
    await getAuthenticatedContext();
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
