import { badRequest, ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { getLaunchPageContributions } from "@/lib/takeoff/page-contributions-server";

// TI-682 lot D: before a launch, the pages of the chosen plans the target version already holds (read only, nothing written).
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => { throw badRequest("Payload JSON invalide."); });
    return ok(await getLaunchPageContributions(body));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
