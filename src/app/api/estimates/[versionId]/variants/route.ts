import { parseEstimateVersionIdResponse, parsePromoteEstimateVariantResponse } from "@/lib/estimates/write-response-contracts";
import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";
import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import {
  createEstimateVariantSchema,
  promoteEstimateVariantSchema,
} from "@/lib/estimates/schemas";
import {
  createEstimateVariant,
  promoteEstimateVariant,
} from "@/lib/estimates/server";
import { parseJsonBodyOrEmptyObject } from "@/lib/http/request";

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
    const versionId = await getVersionId(params);
    promoteEstimateVariantSchema.parse(await parseJsonBodyOrEmptyObject(request, badRequest));
    const data = await promoteEstimateVariant(versionId);
    return ok(validateEstimateResponse(() => parsePromoteEstimateVariantResponse(data, versionId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
