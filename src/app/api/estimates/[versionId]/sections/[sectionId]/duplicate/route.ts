import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";
import { parseDuplicateSectionResponse } from "@/lib/estimates/section-copy-response";
import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { duplicateEstimateSectionSchema } from "@/lib/estimates/schemas";
import { duplicateSectionFromVersion } from "@/lib/estimates/section-copy-server";
import { parseJsonBodyOrEmptyObject, uuidRouteParams } from "@/lib/http/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string; sectionId: string }> }
) {
  try {
    const { versionId, sectionId } = await uuidRouteParams(params, "versionId", "sectionId");
    const body = duplicateEstimateSectionSchema.parse(
      await parseJsonBodyOrEmptyObject(request, badRequest)
    );
    const data = await duplicateSectionFromVersion(versionId, sectionId, body);
    return ok(validateEstimateResponse(() => parseDuplicateSectionResponse(data, { sourceVersionId: versionId, targetVersionId: body.target_version_id ?? versionId })), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
