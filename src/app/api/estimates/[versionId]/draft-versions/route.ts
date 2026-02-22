import { z } from "zod";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { listEstimateProjectDraftVersions } from "@/lib/estimates/server";

const paramsSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).versionId;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const data = await listEstimateProjectDraftVersions(versionId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
