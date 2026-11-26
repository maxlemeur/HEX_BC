import { priceExplanationSettingsSchema } from "@/lib/estimates/explanation-schemas";
import { refreshEstimateLineExplanationSettings } from "@/lib/estimates/explanations";
import { forbidden, ok, toErrorResponse } from "@/lib/http/api-response";
import { uuidRouteParams } from "@/lib/http/request";
import { isSameOriginRequest } from "@/lib/http/same-origin";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string; lineId: string }> }
) {
  try {
    if (!isSameOriginRequest(request)) throw forbidden("Origine de la demande refusée.");
    const scope = await uuidRouteParams(params, "versionId", "lineId");
    return ok(priceExplanationSettingsSchema.parse(await refreshEstimateLineExplanationSettings(scope)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
