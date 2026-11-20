import { z } from "zod";

import { ok, toErrorResponse, badRequest } from "@/lib/http/api-response";
import { estimatePurchaseOrderDraftsCreateSchema } from "@/lib/estimates/schemas";
import {
  createEstimatePurchaseOrderDrafts,
  getEstimatePurchaseOrderDraftPreparation,
  getEstimatePurchaseOrderReceipt,
} from "@/lib/estimates/purchase-order-drafts";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await uuidRouteParam(params, "versionId");
    const key = new URL(request.url).searchParams.get("idempotency_key");
    const data = key === null
      ? await getEstimatePurchaseOrderDraftPreparation(versionId)
      : await getEstimatePurchaseOrderReceipt(versionId, z.string().uuid().parse(key));
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
    const body = estimatePurchaseOrderDraftsCreateSchema.parse(
      await parseJsonBody(request, badRequest)
    );
    const data = await createEstimatePurchaseOrderDrafts(versionId, body);
    return ok(data, data.replayed ? 200 : 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
