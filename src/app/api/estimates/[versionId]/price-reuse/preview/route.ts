import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { priceReusePreviewInputSchema } from "@/lib/estimates/price-reuse-contracts";
import { previewPriceReuse } from "@/lib/estimates/price-reuse-server";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

/** Comparaison en lecture seule avec un devis de référence (docs/metier/reprise-des-prix.md). */
export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const body = priceReusePreviewInputSchema.parse(await parseJsonBody(request, badRequest));
    return ok(await previewPriceReuse(versionId, body));
  } catch (error) {
    return toErrorResponse(error);
  }
}
