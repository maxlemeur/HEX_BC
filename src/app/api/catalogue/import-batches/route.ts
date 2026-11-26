import { catalogueImportBatchCursorParameterSchema } from "@/lib/catalogue/import-review-contract";
import { listCatalogueImportBatches } from "@/lib/catalogue/import-review-server";
import { ok, toErrorResponse } from "@/lib/http/api-response";

export async function GET(request: Request) {
  try {
    const cursor = new URL(request.url).searchParams.get("cursor");
    const position = cursor === null ? undefined : catalogueImportBatchCursorParameterSchema.parse(cursor);
    return ok(await listCatalogueImportBatches(position));
  } catch (error) {
    return toErrorResponse(error);
  }
}
