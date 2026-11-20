import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { priceReuseApplyInputSchema } from "@/lib/estimates/price-reuse-contracts";
import { applyPriceReuse } from "@/lib/estimates/price-reuse-server";
import { parseJsonBody } from "@/lib/http/request";

const versionIdParamSchema = z.object({ versionId: z.string().uuid("versionId invalide.") });

/** Reprise des prix confirmée : une écriture atomique du brouillon au jeton If-Match (docs/metier/reprise-des-prix.md). */
export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  try {
    const { versionId } = versionIdParamSchema.parse(await params);
    const body = priceReuseApplyInputSchema.parse(await parseJsonBody(request, badRequest));
    return ok(await applyPriceReuse(versionId, body, request.headers.get("if-match")?.trim() || null));
  } catch (error) {
    return toErrorResponse(error);
  }
}
