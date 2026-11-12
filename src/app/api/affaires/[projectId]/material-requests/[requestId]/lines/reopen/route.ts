import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { materialRequestLineIdsSchema } from "@/lib/material-requests/contracts";
import { readJsonBody, requestParamsSchema } from "@/lib/material-requests/http";
import { reopenMaterialRequestLines } from "@/lib/material-requests/server";

type Context = { params: Promise<{ projectId: string; requestId: string }> };

/** Validated lines of the selection return to draft. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    const { ids } = materialRequestLineIdsSchema.parse(await readJsonBody(request));
    return ok(await reopenMaterialRequestLines(projectId, requestId, ids));
  } catch (error) {
    return toErrorResponse(error);
  }
}
