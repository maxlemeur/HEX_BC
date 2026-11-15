import { parseSaveEstimateVersionResponse } from "@/lib/estimates/write-response-contracts";
import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";
import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { patchEstimateVersionSchema } from "@/lib/estimates/schemas";
import {
  getEstimateVersionDetails,
  patchEstimateVersion,
} from "@/lib/estimates/server";
import { parseJsonBody, resolveConcurrencyToken } from "@/lib/http/request";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return versionIdParamSchema.parse(params).versionId;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const data = await getEstimateVersionDetails(versionId, { includeEditorTaxRates: true });
    return ok(data);
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
    const body = patchEstimateVersionSchema.parse(await parseJsonBody(request, badRequest));
    const token = resolveConcurrencyToken(request, body.updated_at);
    const data = await patchEstimateVersion(versionId, body, token);
    return ok(validateEstimateResponse(() => parseSaveEstimateVersionResponse(data, versionId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
