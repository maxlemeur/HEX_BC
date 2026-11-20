import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { getTakeoffJobPageReplacement } from "@/lib/takeoff/page-replacement-server";

// TI-682 lot D, PR 2: what applying this takeoff would replace, page by page, in the version it writes into (its own),
// with the wizard's mapping overrides. Reads only: the decisions are sent with the application.
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const body = await request.json().catch(() => null);
    return ok(await getTakeoffJobPageReplacement((await params).jobId, body));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
