import { z } from "zod";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { readJsonBody } from "@/lib/material-requests/http";
import { receivePurchaseOrderSchema } from "@/lib/purchase-orders/lifecycle-contracts";
import { receivePurchaseOrder } from "@/lib/purchase-orders/lifecycle-server";

type Context = { params: Promise<{ id: string }> };

const paramsSchema = z.object({ id: z.string().uuid() });

/** Records the reception of a whole confirmed order of an affaire, dated, with a note (TI-691, delivery 3b-1). */
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = paramsSchema.parse(await params);
    const input = receivePurchaseOrderSchema.parse(await readJsonBody(request));
    return ok(await receivePurchaseOrder(id, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
