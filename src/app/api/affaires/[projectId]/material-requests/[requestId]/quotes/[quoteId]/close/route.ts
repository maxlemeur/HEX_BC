import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { quoteParamsSchema } from "@/lib/material-requests/http";
import { closeMaterialRequestQuote } from "@/lib/material-requests/quotes-server";

type Context = { params: Promise<{ projectId: string; requestId: string; quoteId: string }> };

/** Closes a quote still in progress by hand; it stays readable (TI-691). */
export async function POST(_request: Request, { params }: Context) {
  try {
    const { projectId, requestId, quoteId } = quoteParamsSchema.parse(await params);
    return ok(await closeMaterialRequestQuote(projectId, requestId, quoteId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
