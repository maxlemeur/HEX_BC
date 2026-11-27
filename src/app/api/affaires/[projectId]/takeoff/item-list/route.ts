import { ok, toErrorResponse } from "@/lib/http/api-response";
import { uuidRouteParamsOr404 } from "@/lib/http/request";
import { loadAffaireItemList } from "@/lib/takeoff/item-list-server";

/** The affaire's item list, for any of its readers: stored revision, history, sources and the proposed revision. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await uuidRouteParamsOr404(params, "Affaire introuvable.", "projectId");
    return ok(await loadAffaireItemList(projectId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
