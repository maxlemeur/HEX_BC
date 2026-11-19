import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";
import { parseImportLinkedDpgfResponse } from "@/lib/estimates/section-copy-response";

import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { importLinkedDpgfSourceSchema } from "@/lib/estimates/schemas";
import { importLinkedDpgfSourceIntoVersion } from "@/lib/estimates/server";
import { parseJsonBodyOrEmptyObject, uuidRouteParam } from "@/lib/http/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const body = importLinkedDpgfSourceSchema.parse(await parseJsonBodyOrEmptyObject(request, badRequest));
    const data = await importLinkedDpgfSourceIntoVersion(versionId, body);
    return ok(validateEstimateResponse(() => parseImportLinkedDpgfResponse(data, versionId)), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
