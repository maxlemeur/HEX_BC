import { z } from "zod";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { getEstimateStructureDraft } from "@/lib/estimates/structure-drafts";

const paramsSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  draftId: z.string().uuid("draftId invalide."),
});

async function getParams(
  paramsPromise: Promise<{ versionId: string; draftId: string }>
) {
  return paramsSchema.parse(await paramsPromise);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string; draftId: string }> }
) {
  try {
    const { versionId, draftId } = await getParams(params);
    const data = await getEstimateStructureDraft(versionId, draftId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
