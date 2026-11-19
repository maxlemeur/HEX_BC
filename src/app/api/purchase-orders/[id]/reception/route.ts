import { ok, toErrorResponse } from "@/lib/http/api-response";
import { readJsonBody } from "@/lib/http/json-body";
import { idParamsSchema } from "@/lib/http/request";
import { receivePurchaseOrderSchema } from "@/lib/purchase-orders/lifecycle-contracts";
import { receivePurchaseOrder } from "@/lib/purchase-orders/lifecycle-server";

type Context = { params: Promise<{ id: string }> };

/** Records the reception of a whole confirmed order of an affaire, dated, with a note (TI-691, delivery 3b-1). */
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = idParamsSchema.parse(await params);
    const input = receivePurchaseOrderSchema.parse(await readJsonBody(request));
    return ok(await receivePurchaseOrder(id, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
