import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";
import { parseImportSectionsResponse } from "@/lib/estimates/section-copy-response";

import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { importEstimateSectionsSchema } from "@/lib/estimates/schemas";
import { importSectionsFromVersion } from "@/lib/estimates/server";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const body = importEstimateSectionsSchema.parse(await parseJsonBody(request, badRequest));
    const data = await importSectionsFromVersion(versionId, body);
    return ok(validateEstimateResponse(() => parseImportSectionsResponse(data, { sourceVersionId: body.source_version_id, targetVersionId: versionId, mode: body.mode })), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
