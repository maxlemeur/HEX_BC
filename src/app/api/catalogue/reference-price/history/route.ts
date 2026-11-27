import { referencePriceHistoryQuerySchema } from "@/lib/catalogue/reference-price-schemas";
import { getReferencePriceHistory } from "@/lib/catalogue/reference-price-server";
import { ok, toErrorResponse } from "@/lib/http/api-response";
import { searchParamsObject } from "@/lib/http/request";

export async function GET(request: Request) {
  try {
    const query = referencePriceHistoryQuerySchema.parse(searchParamsObject(request));
    return ok(await getReferencePriceHistory(query));
  } catch (error) {
    return toErrorResponse(error);
  }
}
