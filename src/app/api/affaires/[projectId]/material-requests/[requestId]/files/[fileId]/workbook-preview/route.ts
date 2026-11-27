import { ApiError, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { fileParamsSchema } from "@/lib/material-requests/http";
import { previewMaterialRequestWorkbookImport } from "@/lib/material-requests/workbook-import-server";
import { MaterialRequestWorkbookBusyError, MaterialRequestWorkbookError } from "@/lib/material-requests/workbook-preview";
import { materialRequestWorkbookColumnsParamSchema } from "@/lib/material-requests/workbook-preview-contract";

export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string; requestId: string; fileId: string }> };

export async function GET(request: Request, { params }: Context) {
  let response: Response;
  try {
    const { projectId, requestId, fileId } = fileParamsSchema.parse(await params);
    const query = new URL(request.url).searchParams;
    const sheet = query.get("sheet") ?? undefined;
    const columns = query.get("columns");
    const mapping = columns === null ? undefined : materialRequestWorkbookColumnsParamSchema.parse(columns);
    response = ok(await previewMaterialRequestWorkbookImport(projectId, requestId, fileId, { sheet, mapping }, request.signal));
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
