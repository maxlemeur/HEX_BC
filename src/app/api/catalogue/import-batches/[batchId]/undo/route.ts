import { undoCatalogueImportBatch } from "@/lib/catalogue/import-review-server";
import { ok, toErrorResponse } from "@/lib/http/api-response";
import { uuidRouteParam } from "@/lib/http/request";

type Context = { params: Promise<{ batchId: string }> };

// An import of 2 600 drafts is removed 500 rows at a time.
export const maxDuration = 60;

export async function POST(_request: Request, { params }: Context) {
  try {
    return ok(await undoCatalogueImportBatch(await uuidRouteParam(params, "batchId")));
  } catch (error) {
    return toErrorResponse(error);
  }
}
