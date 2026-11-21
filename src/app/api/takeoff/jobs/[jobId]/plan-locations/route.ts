import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { readTakeoffJobPlanLocations } from "@/lib/takeoff/plan-location-server";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    return ok(await readTakeoffJobPlanLocations((await params).jobId));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
