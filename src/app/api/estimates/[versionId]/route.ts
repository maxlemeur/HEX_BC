import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { patchEstimateVersionSchema } from "@/lib/estimates/schemas";
import {
  getEstimateVersionDetails,
  patchEstimateVersion,
} from "@/lib/estimates/server";

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const data = await getEstimateVersionDetails(versionId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const body = patchEstimateVersionSchema.parse(await parseJsonBody(request));
    const token = resolveConcurrencyToken(request, body.updated_at);
    const data = await patchEstimateVersion(versionId, body, token);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
