import { parseBulkUpdateEstimateItemsResponse } from "@/lib/estimates/write-response-contracts";
import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";
import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { bulkUpdateEstimateItemsRequestSchema } from "@/lib/estimates/schemas";
import { bulkUpdateEstimateItems } from "@/lib/estimates/server";
import { parseJsonBody, resolveConcurrencyToken } from "@/lib/http/request";

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
    const body = bulkUpdateEstimateItemsRequestSchema.parse(
      await parseJsonBody(request, badRequest)
    );
    const token = resolveConcurrencyToken(request, body.updated_at);
    const data = await bulkUpdateEstimateItems(
      versionId,
      body.updates,
      token,
      body.version_patch
    );
    return ok(validateEstimateResponse(() => parseBulkUpdateEstimateItemsResponse(data, versionId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
