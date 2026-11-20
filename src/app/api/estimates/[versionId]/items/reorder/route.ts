import { parseEstimateItemsReorderResponse } from "@/lib/estimates/item-structure-contracts";
import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";

import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { reorderEstimateItemsSchema } from "@/lib/estimates/schemas";
import { reorderEstimateItems } from "@/lib/estimates/item-structure-server";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const body = reorderEstimateItemsSchema.parse(await parseJsonBody(request, badRequest));
    const data = await reorderEstimateItems(versionId, body, request.headers.get("if-match") ?? undefined);
    return ok(validateEstimateResponse(() => parseEstimateItemsReorderResponse(data, { versionId, parentId: body.parent_id ?? null, orderedIds: body.ordered_ids })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
