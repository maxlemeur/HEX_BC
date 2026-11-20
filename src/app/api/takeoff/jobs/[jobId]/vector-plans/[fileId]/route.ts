import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { readAttestedTakeoffPlan } from "@/lib/takeoff/vectors/read-server";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string; fileId: string }> }) {
  try {
    const { jobId, fileId } = await params;
    const bytes = await readAttestedTakeoffPlan(jobId, fileId);
    return new Response(bytes, { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "none",
    } });
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
