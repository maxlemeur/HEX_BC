import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { generateEstimateStructureDraftSchema } from "@/lib/estimates/schemas";
import { generateEstimateStructureDraft } from "@/lib/estimates/structure-drafts";
import { parseJsonBody } from "@/lib/http/request";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return versionIdParamSchema.parse(params).versionId;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const body = generateEstimateStructureDraftSchema.parse(
      await parseJsonBody(request, badRequest)
    );
    const data = await generateEstimateStructureDraft(versionId, body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
