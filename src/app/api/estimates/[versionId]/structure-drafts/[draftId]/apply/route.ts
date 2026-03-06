import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { applyEstimateStructureDraftSchema } from "@/lib/estimates/schemas";
import { applyEstimateStructureDraft } from "@/lib/estimates/structure-drafts";

const paramsSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  draftId: z.string().uuid("draftId invalide."),
});

async function getParams(
  paramsPromise: Promise<{ versionId: string; draftId: string }>
) {
  return paramsSchema.parse(await paramsPromise);
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string; draftId: string }> }
) {
  try {
    const { versionId, draftId } = await getParams(params);
    const body = applyEstimateStructureDraftSchema.parse(
      await parseJsonBody(request)
    );
    const data = await applyEstimateStructureDraft(versionId, draftId, body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
