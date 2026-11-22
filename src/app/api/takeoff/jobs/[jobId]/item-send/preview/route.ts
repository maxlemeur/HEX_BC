import { ok } from "@/lib/http/api-response";
import { itemSendPreviewResponseSchema } from "@/lib/takeoff/item-send-contracts";
import { previewTakeoffItemSend } from "@/lib/takeoff/item-send-preview-server";
import { parseTakeoffResponse } from "@/lib/takeoff/response-contracts";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";

/** Lot 4, PR 5a: the read-only preview of the send of one plan's answers by item; writes nothing. */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const jobId = (await params).jobId;
    const body = await request.json().catch(() => ({}));
    return ok(parseTakeoffResponse(itemSendPreviewResponseSchema, await previewTakeoffItemSend(jobId, body)));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
