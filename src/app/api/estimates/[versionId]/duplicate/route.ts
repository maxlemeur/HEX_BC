import { z } from "zod";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { duplicateEstimateVersion } from "@/lib/estimates/server";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return versionIdParamSchema.parse(params).versionId;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const data = await duplicateEstimateVersion(versionId);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
