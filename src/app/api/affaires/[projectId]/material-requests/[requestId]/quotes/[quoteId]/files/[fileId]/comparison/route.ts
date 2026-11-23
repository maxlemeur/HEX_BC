import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { parseJsonBodyOrEmptyObject } from "@/lib/http/request";
import { fileParamsSchema, quoteParamsSchema } from "@/lib/material-requests/http";
import { quoteComparisonSettingsSchema } from "@/lib/material-requests/quote-comparison";
import { analyzeMaterialRequestQuote } from "@/lib/material-requests/quote-comparison-server";

type Context = { params: Promise<{ projectId: string; requestId: string; quoteId: string; fileId: string }> };
const paramsSchema = fileParamsSchema.extend(quoteParamsSchema.shape);

export async function POST(request: Request, { params }: Context) {
  try {
    const { projectId, requestId, quoteId, fileId } = paramsSchema.parse(await params);
    const settings = quoteComparisonSettingsSchema.parse(await parseJsonBodyOrEmptyObject(request, badRequest));
    return ok(await analyzeMaterialRequestQuote(projectId, requestId, quoteId, fileId, settings));
  } catch (error) {
    return toErrorResponse(error);
  }
}
