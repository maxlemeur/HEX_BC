import { ApiError, ok, unauthorized } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { reviseContribution } from "@/lib/takeoff/contribution-revision-server";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    return ok(await reviseContribution((await params).jobId, await request.json().catch(() => null)));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return toTakeoffRouteErrorResponse(unauthorized("Connectez-vous pour consulter ou corriger cet envoi."));
    }
    return toTakeoffRouteErrorResponse(error);
  }
}
