import {
  badRequest,
  ok,
  resolvePriceImportSuggestions,
  toErrorResponse,
} from "@/lib/catalogue/server";
import { resolvePriceImportSuggestionsSchema } from "@/lib/catalogue/schemas";

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request);
    const payload = resolvePriceImportSuggestionsSchema.parse(body);
    const data = await resolvePriceImportSuggestions(payload);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
