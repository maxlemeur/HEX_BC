import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { createEstimateCategorySchema } from "@/lib/estimates/schemas";
import { createEstimateCategory } from "@/lib/estimates/reference-data-server";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const body = createEstimateCategorySchema.parse(await parseJsonBody(request, badRequest));
    const data = await createEstimateCategory(versionId, body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
