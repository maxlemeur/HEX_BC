import { listCatalogueImportBatches } from "@/lib/catalogue/import-review-server";
import { ok, toErrorResponse } from "@/lib/http/api-response";

export async function GET() {
  try {
    return ok(await listCatalogueImportBatches());
  } catch (error) {
    return toErrorResponse(error);
  }
}
