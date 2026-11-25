import { bulkProductsSchema } from "@/lib/catalogue/import-review-contract";
import { bulkUpdateProducts } from "@/lib/catalogue/import-review-server";
import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";

// The drafts of an import are read, then validated in batches of 5 000.
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    return ok(await bulkUpdateProducts(bulkProductsSchema.parse(await parseJsonBody(request, badRequest))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
