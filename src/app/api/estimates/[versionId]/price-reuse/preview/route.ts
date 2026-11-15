import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { priceReusePreviewInputSchema } from "@/lib/estimates/price-reuse-contracts";
import { previewPriceReuse } from "@/lib/estimates/price-reuse-server";
import { parseJsonBody } from "@/lib/http/request";

const versionIdParamSchema = z.object({ versionId: z.string().uuid("versionId invalide.") });

/** Comparaison en lecture seule avec un devis de référence (docs/metier/reprise-des-prix.md). */
export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  try {
    const { versionId } = versionIdParamSchema.parse(await params);
    const body = priceReusePreviewInputSchema.parse(await parseJsonBody(request, badRequest));
    return ok(await previewPriceReuse(versionId, body));
  } catch (error) {
    return toErrorResponse(error);
  }
}
