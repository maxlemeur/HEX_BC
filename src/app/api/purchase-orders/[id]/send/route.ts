import { ok, toErrorResponse } from "@/lib/http/api-response";
import { readJsonBody } from "@/lib/http/json-body";
import { idParamsSchema } from "@/lib/http/request";
import { sendPurchaseOrderSchema } from "@/lib/purchase-orders/send-contracts";
import { sendPurchaseOrder } from "@/lib/purchase-orders/send-server";

type Context = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
/** Three attempts of the provider at most (send-server.ts): well under the five minutes after which a claim is dead. */
export const maxDuration = 120;

/** Sends a draft purchase order to its supplier by e-mail, the order attached as a PDF. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = idParamsSchema.parse(await params);
    const input = sendPurchaseOrderSchema.parse(await readJsonBody(request));
    return ok(await sendPurchaseOrder(id, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
