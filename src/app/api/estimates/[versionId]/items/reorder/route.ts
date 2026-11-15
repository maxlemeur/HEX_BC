import { parseEstimateItemsReorderResponse } from "@/lib/estimates/item-structure-contracts";
import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";
import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { reorderEstimateItemsSchema } from "@/lib/estimates/schemas";
import { reorderEstimateItems } from "@/lib/estimates/server";
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
    const body = reorderEstimateItemsSchema.parse(await parseJsonBody(request, badRequest));
    const data = await reorderEstimateItems(versionId, body, request.headers.get("if-match") ?? undefined);
    return ok(validateEstimateResponse(() => parseEstimateItemsReorderResponse(data, { versionId, parentId: body.parent_id ?? null, orderedIds: body.ordered_ids })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
