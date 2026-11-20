import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { generateEstimateStructureDraftSchema } from "@/lib/estimates/schemas";
import { generateEstimateStructureDraft } from "@/lib/estimates/structure-drafts";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const body = generateEstimateStructureDraftSchema.parse(
      await parseJsonBody(request, badRequest)
    );
    const data = await generateEstimateStructureDraft(versionId, body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
