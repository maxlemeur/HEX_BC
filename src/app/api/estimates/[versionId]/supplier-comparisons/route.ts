import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { estimateSupplierComparisonsRequestSchema } from "@/lib/estimates/schemas";
import { getEstimateSupplierComparisons } from "@/lib/estimates/supplier-comparison-server";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const body = estimateSupplierComparisonsRequestSchema.parse(
      await parseJsonBody(request, badRequest)
    );
    const data = await getEstimateSupplierComparisons(versionId, body.item_ids);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
