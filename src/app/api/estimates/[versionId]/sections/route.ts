import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";
import { parseImportSectionsPreviewResponse } from "@/lib/estimates/section-copy-response";

import { ok, toErrorResponse } from "@/lib/http/api-response";
import { listEstimateImportSections } from "@/lib/estimates/section-copy-read-server";
import { uuidRouteParam } from "@/lib/http/request";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const data = await listEstimateImportSections(versionId);
    return ok(validateEstimateResponse(() => parseImportSectionsPreviewResponse(data, versionId)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
