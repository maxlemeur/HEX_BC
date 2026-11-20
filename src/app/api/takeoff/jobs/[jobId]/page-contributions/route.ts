import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { getTakeoffJobPageContributions } from "@/lib/takeoff/page-contributions-server";

// TI-682 lot D: the pages of this takeoff that another takeoff already brought into the reviewed estimate version
// (`version_id`: its own, or a copy it was carried over into). Read only.
export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const versionId = new URL(request.url).searchParams.get("version_id");
    return ok(await getTakeoffJobPageContributions((await params).jobId, versionId));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
