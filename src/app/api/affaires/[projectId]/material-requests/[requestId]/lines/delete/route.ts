import { ok, toErrorResponse } from "@/lib/http/api-response";
import { readJsonBody } from "@/lib/http/json-body";
import { materialRequestLineIdsSchema } from "@/lib/material-requests/contracts";
import { requestParamsSchema } from "@/lib/material-requests/http";
import { bulkDeleteMaterialRequestLines } from "@/lib/material-requests/server";

type Context = { params: Promise<{ projectId: string; requestId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    const { ids } = materialRequestLineIdsSchema.parse(await readJsonBody(request));
    return ok(await bulkDeleteMaterialRequestLines(projectId, requestId, ids));
  } catch (error) {
    return toErrorResponse(error);
  }
}
