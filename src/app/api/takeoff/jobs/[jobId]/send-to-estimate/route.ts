import { ok } from "@/lib/http/api-response";
import { parseTakeoffResponse } from "@/lib/takeoff/response-contracts";
import { takeoffSendResponseSchema } from "@/lib/takeoff/send-contracts";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { sendTakeoffJob } from "@/lib/takeoff/send-server";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const jobId = (await params).jobId;
    const body = await request.json();
    return ok(parseTakeoffResponse(takeoffSendResponseSchema, await sendTakeoffJob(jobId, body)));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
