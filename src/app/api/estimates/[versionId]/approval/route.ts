import { z } from "zod";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { getEstimateApprovalSummary } from "@/lib/estimates/rules-engine";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return versionIdParamSchema.parse(params).versionId;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const summary = await getEstimateApprovalSummary(versionId);
    return ok(summary);
  } catch (error) {
    return toErrorResponse(error);
  }
}
