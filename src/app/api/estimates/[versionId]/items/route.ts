import { parseEstimateItemDeleteResponse } from "@/lib/estimates/item-structure-contracts";
import { validateEstimateResponse } from "@/lib/estimates/response-validation-server";
import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import {
  createEstimateItemSchema,
  deleteEstimateItemSchema,
  updateEstimateItemSchema,
} from "@/lib/estimates/schemas";
import {
  createEstimateItem,
  deleteEstimateItem,
  listEstimateItems,
  updateEstimateItem,
} from "@/lib/estimates/server";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return versionIdParamSchema.parse(params).versionId;
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
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
    const versionId = await getVersionId(params);
    const body = createEstimateItemSchema.parse(await parseJsonBody(request));
    const data = await createEstimateItem(versionId, body, request.headers.get("if-match") ?? undefined);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const body = updateEstimateItemSchema.parse(await parseJsonBody(request));
    const data = await updateEstimateItem(versionId, body, request.headers.get("if-match") ?? undefined);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const body = deleteEstimateItemSchema.parse(await parseJsonBody(request));
    const data = await deleteEstimateItem(versionId, body, request.headers.get("if-match") ?? undefined);
    return ok(validateEstimateResponse(() => parseEstimateItemDeleteResponse(data, versionId, body.id)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
