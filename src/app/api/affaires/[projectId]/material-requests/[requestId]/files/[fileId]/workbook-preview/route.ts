import { ApiError, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { readMaterialRequestWorkbookOriginal } from "@/lib/material-requests/files-server";
import { fileParamsSchema } from "@/lib/material-requests/http";
import {
  MaterialRequestWorkbookBusyError,
  MaterialRequestWorkbookError,
  previewMaterialRequestWorkbook,
} from "@/lib/material-requests/workbook-preview";

export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string; requestId: string; fileId: string }> };

export async function GET(request: Request, { params }: Context) {
  let response: Response;
  try {
    const { projectId, requestId, fileId } = fileParamsSchema.parse(await params);
    const sheet = new URL(request.url).searchParams.get("sheet") ?? undefined;
    const body = await readMaterialRequestWorkbookOriginal(projectId, requestId, fileId);
    response = ok(await previewMaterialRequestWorkbook(Buffer.from(await body.arrayBuffer()), sheet, request.signal));
  } catch (error) {
    if (error instanceof MaterialRequestWorkbookBusyError) {
      response = toErrorResponse(new ApiError({ status: 503, code: "MATERIAL_REQUEST_WORKBOOK_BUSY", message: error.message }));
      response.headers.set("Retry-After", "3");
    } else {
      response = toErrorResponse(error instanceof MaterialRequestWorkbookError ? unprocessableEntity(error.message) : error);
    }
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
