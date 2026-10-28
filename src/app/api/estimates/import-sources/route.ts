import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";
import { parseImportSourcesResponse } from "@/lib/estimates/section-copy-response";
import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { listEstimateImportSourcesQuerySchema } from "@/lib/estimates/schemas";
import { listEstimateImportSources } from "@/lib/estimates/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = listEstimateImportSourcesQuerySchema.parse({
      exclude_version_id:
        searchParams.get("exclude_version_id") ??
        searchParams.get("excludeVersionId"),
    });
    const data = await listEstimateImportSources(query);
    return ok(validateEstimateResponse(() => parseImportSourcesResponse(data)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
