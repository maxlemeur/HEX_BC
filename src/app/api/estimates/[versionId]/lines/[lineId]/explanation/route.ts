import {
  estimateExplanationDetailQuerySchema,
  estimateExplanationResponseSchema,
} from "@/lib/estimates/explanation-schemas";
import { ok, toErrorResponse } from "@/lib/http/api-response";
import { uuidRouteParams } from "@/lib/http/request";
import { getEstimateLineExplanation } from "@/lib/estimates/explanations";

export const runtime = "nodejs";

function parseQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  return estimateExplanationDetailQuerySchema.parse({
    detail: searchParams.get("detail") ?? undefined,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string; lineId: string }> }
) {
  try {
    const { versionId, lineId } = await uuidRouteParams(params, "versionId", "lineId");
    const query = parseQuery(request);
    const explanation = await getEstimateLineExplanation({
      versionId,
      lineId,
      includeDetail: query.detail,
    });

    return ok(
      estimateExplanationResponseSchema.parse({
        explanation,
      })
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
