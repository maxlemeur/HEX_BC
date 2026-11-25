import { pendingReferencesQuerySchema, reviewReferencesSchema } from "@/lib/catalogue/import-review-contract";
import { listPendingSupplierReferences, reviewSupplierReferences } from "@/lib/catalogue/import-review-server";
import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";

// A review of the whole queue reads its references, then writes them in batches of 5 000.
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = pendingReferencesQuerySchema.parse(Object.fromEntries(
      ["page", "size", "supplier_id", "import_batch_id", "q"].flatMap((key) => {
        const value = searchParams.get(key);
        return value === null || value === "" ? [] : [[key, value]];
      }),
    ));
    return ok(await listPendingSupplierReferences(query));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await reviewSupplierReferences(reviewReferencesSchema.parse(await parseJsonBody(request, badRequest))));
  } catch (error) {
    return toErrorResponse(error);
  }
}
