import { parseSaveEstimateVersionResponse } from "@/lib/estimates/write-response-contracts";
import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";

import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { patchEstimateVersionSchema } from "@/lib/estimates/schemas";
import {
  getEstimateVersionDetails,
  patchEstimateVersion,
} from "@/lib/estimates/server";
import { parseJsonBody, resolveConcurrencyToken, uuidRouteParam } from "@/lib/http/request";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
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
    const versionId = await uuidRouteParam(params, "versionId");
    const body = patchEstimateVersionSchema.parse(await parseJsonBody(request, badRequest));
    const token = resolveConcurrencyToken(request, body.updated_at);
    const data = await patchEstimateVersion(versionId, body, token);
    return ok(validateEstimateResponse(() => parseSaveEstimateVersionResponse(data, versionId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
