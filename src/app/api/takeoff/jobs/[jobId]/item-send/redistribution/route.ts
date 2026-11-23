import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { redistributeTakeoffItem } from "@/lib/takeoff/item-redistribution-server";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    return ok(await redistributeTakeoffItem((await params).jobId, await request.json().catch(() => null)));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
