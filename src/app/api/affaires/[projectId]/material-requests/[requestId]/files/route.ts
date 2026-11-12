import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { prepareMaterialRequestFilesSchema } from "@/lib/material-requests/contracts";
import { prepareMaterialRequestFiles } from "@/lib/material-requests/files-server";
import { readJsonBody, requestParamsSchema } from "@/lib/material-requests/http";

type Context = { params: Promise<{ projectId: string; requestId: string }> };

/**
 * Prepares the upload of originals: the photos themselves go from the browser straight to storage, with
 * the signed uploads this answers, then `files/complete` checks them and makes them visible.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    const { files } = prepareMaterialRequestFilesSchema.parse(await readJsonBody(request));
    return ok(await prepareMaterialRequestFiles(projectId, requestId, files), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
