import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { quoteParamsSchema, readJsonBody } from "@/lib/material-requests/http";
import { updateQuoteSchema } from "@/lib/material-requests/quote-contracts";
import { updateMaterialRequestQuote } from "@/lib/material-requests/quotes-server";

type Context = { params: Promise<{ projectId: string; requestId: string; quoteId: string }> };

/** Prices, total, notes and reception of a quote still in progress (TI-691). */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const { projectId, requestId, quoteId } = quoteParamsSchema.parse(await params);
    const input = updateQuoteSchema.parse(await readJsonBody(request));
    return ok(await updateMaterialRequestQuote(projectId, requestId, quoteId, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
