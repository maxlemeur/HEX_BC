import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { readJsonBody, requestParamsSchema } from "@/lib/material-requests/http";
import { createMaterialRequestOrdersSchema } from "@/lib/material-requests/order-contracts";
import { createMaterialRequestOrders, getMaterialRequestOrders } from "@/lib/material-requests/orders-server";

type Context = { params: Promise<{ projectId: string; requestId: string }> };

/** Where each line of the request stands for ordering, and the orders made from it (TI-691, delivery 3a). */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    return ok(await getMaterialRequestOrders(projectId, requestId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** One draft purchase order per supplier from the ready lines; the same key answers the same drafts (200, replayed). */
export async function POST(request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    const input = createMaterialRequestOrdersSchema.parse(await readJsonBody(request));
    const created = await createMaterialRequestOrders(projectId, requestId, input);
    return ok(created, created.replayed ? 200 : 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
