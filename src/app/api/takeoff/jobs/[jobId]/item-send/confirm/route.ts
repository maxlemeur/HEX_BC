import { ok } from "@/lib/http/api-response";
import { itemSendConfirmResponseSchema } from "@/lib/takeoff/item-send-contracts";
import { confirmTakeoffItemSend } from "@/lib/takeoff/item-send-confirm-server";
import { parseTakeoffResponse } from "@/lib/takeoff/response-contracts";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";

/**
 * Lot 4, PR 5b: the confirmation of the send of one plan's answers by item. The server computes the plan again from the
 * stored facts and the member's choices, and the writer applies it in one transaction; the same intention key answers
 * the same receipt.
 */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const jobId = (await params).jobId;
    const body = await request.json().catch(() => null);
    return ok(parseTakeoffResponse(itemSendConfirmResponseSchema, await confirmTakeoffItemSend(jobId, body)));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
