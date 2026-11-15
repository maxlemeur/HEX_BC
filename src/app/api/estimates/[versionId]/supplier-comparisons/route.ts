import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { estimateSupplierComparisonsRequestSchema } from "@/lib/estimates/schemas";
import { getEstimateSupplierComparisons } from "@/lib/estimates/server";
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
    const body = estimateSupplierComparisonsRequestSchema.parse(
      await parseJsonBody(request, badRequest)
    );
    const data = await getEstimateSupplierComparisons(versionId, body.item_ids);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
