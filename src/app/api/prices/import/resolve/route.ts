import {
  badRequest,
  ok,
  resolvePriceImportSuggestions,
  toErrorResponse,
} from "@/lib/catalogue/server";
import { resolvePriceImportSuggestionsSchema } from "@/lib/catalogue/schemas";
import { parseJsonBody } from "@/lib/http/request";

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request, badRequest);
    const payload = resolvePriceImportSuggestionsSchema.parse(body);
    const data = await resolvePriceImportSuggestions(payload);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
