import { referencePriceHistoryQuerySchema } from "@/lib/catalogue/reference-price-schemas";
import { getReferencePriceHistory } from "@/lib/catalogue/reference-price-server";
import { ok, toErrorResponse } from "@/lib/http/api-response";

export async function GET(request: Request) {
  try {
    const query = referencePriceHistoryQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return ok(await getReferencePriceHistory(query));
  } catch (error) {
    return toErrorResponse(error);
  }
}
