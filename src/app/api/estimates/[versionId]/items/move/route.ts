import { parseEstimateItemsMoveResponse } from "@/lib/estimates/item-structure-contracts";
import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";

import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { moveEstimateItemSchema } from "@/lib/estimates/schemas";
import { moveEstimateItem } from "@/lib/estimates/item-structure-server";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const body = moveEstimateItemSchema.parse(await parseJsonBody(request, badRequest));
    const data = await moveEstimateItem(versionId, body, request.headers.get("if-match") ?? undefined);
    return ok(validateEstimateResponse(() => parseEstimateItemsMoveResponse(data, versionId, body)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
