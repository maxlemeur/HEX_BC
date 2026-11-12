import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { quoteParamsSchema } from "@/lib/material-requests/http";
import { retainMaterialRequestQuote } from "@/lib/material-requests/quotes-server";

type Context = { params: Promise<{ projectId: string; requestId: string; quoteId: string }> };

/** Retains a received, fully priced quote: its lines take its supplier and price, its competitors close (TI-691). */
export async function POST(_request: Request, { params }: Context) {
  try {
    const { projectId, requestId, quoteId } = quoteParamsSchema.parse(await params);
    return ok(await retainMaterialRequestQuote(projectId, requestId, quoteId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
