import { z } from "zod";

import { ok, toErrorResponse, badRequest } from "@/lib/estimates/errors";
import { estimatePurchaseOrderDraftsCreateSchema } from "@/lib/estimates/schemas";
import {
  createEstimatePurchaseOrderDrafts,
  getEstimatePurchaseOrderDraftPreparation,
  getEstimatePurchaseOrderReceipt,
} from "@/lib/estimates/purchase-order-drafts";

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
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
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
    const versionId = await getVersionId(params);
    const body = estimatePurchaseOrderDraftsCreateSchema.parse(
      await parseJsonBody(request)
    );
    const data = await createEstimatePurchaseOrderDrafts(versionId, body);
    return ok(data, data.replayed ? 200 : 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
