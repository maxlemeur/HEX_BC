import { z } from "zod";

import { executeEstimateBatch } from "@/lib/estimates/batch";
import { ApiError, badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { batchOperationsSchema } from "@/lib/estimates/schemas";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return versionIdParamSchema.parse(params).versionId;
}

async function parseJsonBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !request.body) {
    throw badRequest("Payload JSON invalide.");
  }
  // Bound bytes while reading; Content-Length alone is not a trustworthy limit.
  const reader = request.body.getReader();
  const body = new Uint8Array(1024 * 1024);
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (part.value.byteLength > body.byteLength - length) {
        throw new ApiError({ status: 413, code: "ESTIMATE_BATCH_PAYLOAD_TOO_LARGE", message: "Le batch dépasse la limite de 1 Mio." });
      }
      body.set(part.value, length);
      length += part.value.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.subarray(0, length)));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw badRequest("Payload JSON invalide.");
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function resolveConcurrencyToken(request: Request, fallback?: string) {
  const ifMatch = request.headers.get("if-match")?.trim();
  if (ifMatch && ifMatch.length > 0) {
    return ifMatch;
  }

  const normalizedFallback = fallback?.trim();
  if (normalizedFallback && normalizedFallback.length > 0) {
    return normalizedFallback;
  }

  return undefined;
}

function parseDryRunFlag(rawValue: string | null) {
  if (rawValue === null) return undefined;

  const value = rawValue.trim().toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw badRequest("dry_run invalide.");
}

function resolveDryRun(request: Request, fallback?: boolean) {
  const parameters = new URL(request.url).searchParams;
  if ([...parameters.keys()].some((key) => key !== "dry_run") || parameters.getAll("dry_run").length > 1) {
    throw badRequest("Paramètres de batch invalides.");
  }
  const parsedFromQuery = parseDryRunFlag(
    parameters.get("dry_run")
  );
  if (typeof parsedFromQuery === "boolean") {
    return parsedFromQuery;
  }
  return fallback === true;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const body = batchOperationsSchema.parse(await parseJsonBody(request));

    const data = await executeEstimateBatch(versionId, body.operations, {
      concurrencyToken: resolveConcurrencyToken(request, body.concurrency_token),
      operationKey: body.operation_key,
      dryRun: resolveDryRun(request, body.dry_run),
    });

    const response = ok(data);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
