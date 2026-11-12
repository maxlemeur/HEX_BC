import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { completeMaterialRequestFilesSchema } from "@/lib/material-requests/contracts";
import { completeMaterialRequestFiles } from "@/lib/material-requests/files-server";
import { readJsonBody, requestParamsSchema } from "@/lib/material-requests/http";

type Context = { params: Promise<{ projectId: string; requestId: string }> };

/**
 * Checks what storage holds for each prepared original, then makes the batch visible. All or nothing:
 * 422 MATERIAL_REQUEST_FILE_REJECTED names every photo that is not what was announced, and none is kept.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    const { ids } = completeMaterialRequestFilesSchema.parse(await readJsonBody(request));
    return ok(await completeMaterialRequestFiles(projectId, requestId, ids));
  } catch (error) {
    return toErrorResponse(error);
  }
}
