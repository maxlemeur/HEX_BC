import { parseBulkUpdateEstimateItemsResponse } from "@/lib/estimates/write-response-contracts";
import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";

import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { bulkUpdateEstimateItemsRequestSchema } from "@/lib/estimates/schemas";
import { bulkUpdateEstimateItems } from "@/lib/estimates/item-bulk-server";
import { parseJsonBody, resolveConcurrencyToken, uuidRouteParam } from "@/lib/http/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
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
