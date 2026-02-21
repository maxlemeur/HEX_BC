import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { patchEstimateStatusSchema } from "@/lib/estimates/schemas";
import { patchEstimateStatus } from "@/lib/estimates/server";

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

function resolveConcurrencyToken(request: Request) {
  const ifMatch = request.headers.get("if-match")?.trim();
  if (ifMatch && ifMatch.length > 0) {
    return ifMatch;
  }

  return undefined;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const body = patchEstimateStatusSchema.parse(await parseJsonBody(request));
    const token = resolveConcurrencyToken(request);
    if (!token) {
      throw badRequest("Jeton de concurrence manquant.");
    }
    const data = await patchEstimateStatus(versionId, body, token);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
