import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { readJsonBody, requestParamsSchema } from "@/lib/material-requests/http";
import { createQuoteSchema } from "@/lib/material-requests/quote-contracts";
import { createMaterialRequestQuote, listMaterialRequestQuotes } from "@/lib/material-requests/quotes-server";

type Context = { params: Promise<{ projectId: string; requestId: string }> };

/** Every quote of the request, closed and retained included, newest first (TI-691). */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    return ok(await listMaterialRequestQuotes(projectId, requestId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Records the quote asked of a supplier, with the message as it was copied into WhatsApp (TI-691). */
export async function POST(request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    const input = createQuoteSchema.parse(await readJsonBody(request));
    return ok(await createMaterialRequestQuote(projectId, requestId, input), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
