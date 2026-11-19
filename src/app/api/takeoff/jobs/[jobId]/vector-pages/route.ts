import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { getTakeoffVectorReading } from "@/lib/takeoff/vectors/read-server";

// TI-662: the vector reading of a takeoff job (pages, scale, groups, item geometry) for the review viewer.
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    return ok(await getTakeoffVectorReading(jobId));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
