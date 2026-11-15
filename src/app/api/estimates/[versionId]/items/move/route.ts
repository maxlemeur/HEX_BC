import { parseEstimateItemsMoveResponse } from "@/lib/estimates/item-structure-contracts";
import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";
import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { moveEstimateItemSchema } from "@/lib/estimates/schemas";
import { moveEstimateItem } from "@/lib/estimates/server";
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
    const body = moveEstimateItemSchema.parse(await parseJsonBody(request, badRequest));
    const data = await moveEstimateItem(versionId, body, request.headers.get("if-match") ?? undefined);
    return ok(validateEstimateResponse(() => parseEstimateItemsMoveResponse(data, versionId, body)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
