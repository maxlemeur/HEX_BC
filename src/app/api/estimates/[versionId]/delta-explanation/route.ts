import {
  estimateDeltaExplanationQuerySchema,
  estimateExplanationResponseSchema,
} from "@/lib/estimates/explanation-schemas";
import { ok, toErrorResponse } from "@/lib/http/api-response";
import { uuidRouteParam } from "@/lib/http/request";
import { getEstimateDeltaExplanation } from "@/lib/estimates/explanations";

export const runtime = "nodejs";

function parseQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  return estimateDeltaExplanationQuerySchema.parse({
    compare_version_id: searchParams.get("compare_version_id"),
    detail: searchParams.get("detail") ?? undefined,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const query = parseQuery(request);
    const explanation = await getEstimateDeltaExplanation({
      versionId,
      compareVersionId: query.compare_version_id,
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
