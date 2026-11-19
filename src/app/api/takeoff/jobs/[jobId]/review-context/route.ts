import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { getTakeoffReviewContext } from "@/lib/takeoff/review-context-server";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    return ok(await getTakeoffReviewContext((await params).jobId));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
