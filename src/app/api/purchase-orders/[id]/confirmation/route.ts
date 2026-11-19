import { ok, toErrorResponse } from "@/lib/http/api-response";
import { readJsonBody } from "@/lib/http/json-body";
import { idParamsSchema } from "@/lib/http/request";
import { confirmPurchaseOrderSchema } from "@/lib/purchase-orders/lifecycle-contracts";
import { confirmPurchaseOrder } from "@/lib/purchase-orders/lifecycle-server";

type Context = { params: Promise<{ id: string }> };

/** Records that a draft of an affaire was ordered, with its real prices and its proof (TI-691, delivery 3b-1). */
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = idParamsSchema.parse(await params);
    const input = confirmPurchaseOrderSchema.parse(await readJsonBody(request));
    return ok(await confirmPurchaseOrder(id, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
