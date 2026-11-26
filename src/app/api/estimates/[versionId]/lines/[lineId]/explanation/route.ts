import {
  estimateExplanationDetailQuerySchema,
  priceExplanationGeneratedResponseSchema,
  priceExplanationGenerationSchema,
  priceExplanationReadResponseSchema,
} from "@/lib/estimates/explanation-schemas";
import { badRequest, forbidden, ok, toErrorResponse } from "@/lib/http/api-response";
import { parseJsonBody, uuidRouteParams } from "@/lib/http/request";
import { isSameOriginRequest } from "@/lib/http/same-origin";
import { generateEstimateLineExplanation, getEstimateLineExplanation } from "@/lib/estimates/explanations";

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
    const result = await getEstimateLineExplanation({
      versionId,
      lineId,
      includeDetail: query.detail,
    });

    const response = ok(priceExplanationReadResponseSchema.parse(result));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string; lineId: string }> }
) {
  try {
    if (!isSameOriginRequest(request)) throw forbidden("Origine de la demande refusée.");
    const scope = await uuidRouteParams(params, "versionId", "lineId");
    const query = parseQuery(request);
    const settings = priceExplanationGenerationSchema.parse(await parseJsonBody(request, badRequest));
    const result = await generateEstimateLineExplanation({
      ...scope, includeDetail: query.detail, settings, signal: request.signal,
    });
    return ok(priceExplanationGeneratedResponseSchema.parse(result));
  } catch (error) {
    return toErrorResponse(error);
  }
}
