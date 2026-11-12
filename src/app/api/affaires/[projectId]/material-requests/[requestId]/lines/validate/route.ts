import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { materialRequestLineIdsSchema } from "@/lib/material-requests/contracts";
import { readJsonBody, requestParamsSchema } from "@/lib/material-requests/http";
import { validateMaterialRequestLines } from "@/lib/material-requests/server";

type Context = { params: Promise<{ projectId: string; requestId: string }> };

/** All or nothing: 422 MATERIAL_REQUEST_LINES_BLOCKED names every line held back, and none is validated. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    const { ids } = materialRequestLineIdsSchema.parse(await readJsonBody(request));
    return ok(await validateMaterialRequestLines(projectId, requestId, ids));
  } catch (error) {
    return toErrorResponse(error);
  }
}
