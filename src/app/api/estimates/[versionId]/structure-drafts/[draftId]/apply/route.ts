import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { applyEstimateStructureDraftSchema } from "@/lib/estimates/schemas";
import { applyEstimateStructureDraft } from "@/lib/estimates/structure-drafts";
import { parseJsonBody, uuidRouteParams } from "@/lib/http/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string; draftId: string }> }
) {
  try {
    const { versionId, draftId } = await uuidRouteParams(params, "versionId", "draftId");
    const body = applyEstimateStructureDraftSchema.parse(
      await parseJsonBody(request, badRequest)
    );
    const data = await applyEstimateStructureDraft(versionId, draftId, body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
