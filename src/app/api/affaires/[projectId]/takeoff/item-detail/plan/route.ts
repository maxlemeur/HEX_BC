import { ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { uuidRouteParamsOr404 } from "@/lib/http/request";
import { readItemDetailPlanRequest } from "@/lib/takeoff/item-detail-address";
import { resolveItemDetailPlan } from "@/lib/takeoff/item-detail-plan-server";

/** The plan a detail of an item shows, for a reader of the affaire: a reading's sealed copy, or the dossier's current one. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await uuidRouteParamsOr404(params, "Affaire introuvable.", "projectId");
    const plan = readItemDetailPlanRequest(new URL(request.url).searchParams);
    if (!plan) throw unprocessableEntity("Le plan demandé n’est pas désigné correctement.", undefined, "TAKEOFF_ITEM_DETAIL_ADDRESS_INVALID");
    return ok(await resolveItemDetailPlan(projectId, plan));
  } catch (error) {
    return toErrorResponse(error);
  }
}
