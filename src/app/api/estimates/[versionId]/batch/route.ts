import { z } from "zod";

import { executeEstimateBatch } from "@/lib/estimates/batch";
import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { batchOperationsSchema } from "@/lib/estimates/schemas";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return versionIdParamSchema.parse(params).versionId;
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
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
  const parsedFromQuery = parseDryRunFlag(
    new URL(request.url).searchParams.get("dry_run")
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
      dryRun: resolveDryRun(request, body.dry_run),
    });

    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
