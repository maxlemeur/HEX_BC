import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { priceReuseArbitrationInputSchema } from "@/lib/estimates/price-reuse-contracts";
import { arbitratePriceReuse } from "@/lib/estimates/price-reuse-server";
import { parseJsonBody } from "@/lib/http/request";

const versionIdParamSchema = z.object({ versionId: z.string().uuid("versionId invalide.") });

/** Arbitrage Decisions ou forfait ChatGPT des lignes à vérifier, sans écriture (docs/metier/reprise-des-prix.md). */
export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  try {
    const { versionId } = versionIdParamSchema.parse(await params);
    const body = priceReuseArbitrationInputSchema.parse(await parseJsonBody(request, badRequest));
    return ok(await arbitratePriceReuse(versionId, body));
  } catch (error) {
    return toErrorResponse(error);
  }
}
