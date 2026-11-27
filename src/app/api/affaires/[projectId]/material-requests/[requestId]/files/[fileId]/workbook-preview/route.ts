import type { z } from "zod";

import { ApiError, badRequest, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { fileParamsSchema } from "@/lib/material-requests/http";
import { previewMaterialRequestWorkbookImport } from "@/lib/material-requests/workbook-import-server";
import { MaterialRequestWorkbookBusyError, MaterialRequestWorkbookError } from "@/lib/material-requests/workbook-preview";
import {
  materialRequestWorkbookColumnsParamSchema,
  materialRequestWorkbookHeaderRowParamSchema,
  materialRequestWorkbookSplitParamSchema,
} from "@/lib/material-requests/workbook-preview-contract";

export const runtime = "nodejs";

/** A query parameter read with its schema; a refusal carries its first French reason, which the screen shows as is. */
function queryValue<Schema extends z.ZodType>(schema: Schema, value: string | null): z.output<Schema> | undefined {
  if (value === null) return undefined;
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Paramètre invalide.");
  return parsed.data;
}

type Context = { params: Promise<{ projectId: string; requestId: string; fileId: string }> };

export async function GET(request: Request, { params }: Context) {
  let response: Response;
  try {
    const { projectId, requestId, fileId } = fileParamsSchema.parse(await params);
    const query = new URL(request.url).searchParams;
    const sheet = query.get("sheet") ?? undefined;
    const mapping = queryValue(materialRequestWorkbookColumnsParamSchema, query.get("columns"));
    const headerRow = queryValue(materialRequestWorkbookHeaderRowParamSchema, query.get("header_row"));
    const splitDimension = queryValue(materialRequestWorkbookSplitParamSchema, query.get("split_dimension"));
    response = ok(await previewMaterialRequestWorkbookImport(
      projectId, requestId, fileId, { sheet, headerRow, mapping, splitDimension }, request.signal,
    ));
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
