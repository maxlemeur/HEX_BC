import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { priceReuseArbitrationInputSchema } from "@/lib/estimates/price-reuse-contracts";
import { arbitratePriceReuse } from "@/lib/estimates/price-reuse-server";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

/** Arbitrage des lignes à vérifier par la source IA choisie, sans écriture (docs/metier/reprise-des-prix.md). */
export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const body = priceReuseArbitrationInputSchema.parse(await parseJsonBody(request, badRequest));
    return ok(await arbitratePriceReuse(versionId, body));
  } catch (error) {
    return toErrorResponse(error);
  }
}
