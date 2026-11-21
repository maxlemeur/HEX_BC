import { ok } from "@/lib/http/api-response";
import { parseTakeoffResponse } from "@/lib/takeoff/response-contracts";
import { takeoffSendPreviewResponseSchema } from "@/lib/takeoff/send-contracts";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { previewTakeoffSend } from "@/lib/takeoff/send-server";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const jobId = (await params).jobId;
    const body = await request.json().catch(() => ({}));
    return ok(parseTakeoffResponse(takeoffSendPreviewResponseSchema, await previewTakeoffSend(jobId, body)));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
