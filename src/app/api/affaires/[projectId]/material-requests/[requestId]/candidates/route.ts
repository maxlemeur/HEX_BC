import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { listMaterialRequestCandidates } from "@/lib/material-requests/articles-server";
import { requestParamsSchema } from "@/lib/material-requests/http";

type Context = { params: Promise<{ projectId: string; requestId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    return ok(await listMaterialRequestCandidates(projectId, requestId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
