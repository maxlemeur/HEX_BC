import { parseEstimateVersionIdResponse, parsePromoteEstimateVariantResponse } from "@/lib/estimates/write-response-contracts";
import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";

import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import {
  createEstimateVariantSchema,
  promoteEstimateVariantSchema,
} from "@/lib/estimates/schemas";
import {
  createEstimateVariant,
  promoteEstimateVariant,
} from "@/lib/estimates/server";
import { parseJsonBodyOrEmptyObject, uuidRouteParam } from "@/lib/http/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    createEstimateVariantSchema.parse(await parseJsonBodyOrEmptyObject(request, badRequest));
    const data = await createEstimateVariant(versionId);
    return ok(validateEstimateResponse(() => parseEstimateVersionIdResponse(data, versionId)), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    promoteEstimateVariantSchema.parse(await parseJsonBodyOrEmptyObject(request, badRequest));
    const data = await promoteEstimateVariant(versionId);
    return ok(validateEstimateResponse(() => parsePromoteEstimateVariantResponse(data, versionId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
