import { parseEstimateItemWriteResponse } from "@/lib/estimates/write-response-contracts";
import { parseEstimateItemDeleteResponse } from "@/lib/estimates/item-structure-contracts";
import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";

import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import {
  createEstimateItemSchema,
  deleteEstimateItemSchema,
  updateEstimateItemSchema,
} from "@/lib/estimates/schemas";
import { createEstimateItem } from "@/lib/estimates/item-create-server";
import { deleteEstimateItem } from "@/lib/estimates/item-structure-server";
import { listEstimateItems } from "@/lib/estimates/version-read-server";
import { updateEstimateItem } from "@/lib/estimates/item-update-server";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const data = await listEstimateItems(versionId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const body = createEstimateItemSchema.parse(await parseJsonBody(request, badRequest));
    const data = await createEstimateItem(versionId, body, request.headers.get("if-match") ?? undefined);
    return ok(validateEstimateResponse(() => parseEstimateItemWriteResponse(data, versionId)), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const body = updateEstimateItemSchema.parse(await parseJsonBody(request, badRequest));
    const data = await updateEstimateItem(versionId, body, request.headers.get("if-match") ?? undefined);
    return ok(validateEstimateResponse(() => parseEstimateItemWriteResponse(data, versionId, body.id)));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const body = deleteEstimateItemSchema.parse(await parseJsonBody(request, badRequest));
    const data = await deleteEstimateItem(versionId, body, request.headers.get("if-match") ?? undefined);
    return ok(validateEstimateResponse(() => parseEstimateItemDeleteResponse(data, versionId, body.id)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
