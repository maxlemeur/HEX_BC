import { ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { searchParamsObject, uuidRouteParamsOr404 } from "@/lib/http/request";
import { itemHistoryQuerySchema } from "@/lib/takeoff/item-table-contracts";
import { readAffaireItemHistory } from "@/lib/takeoff/item-table-server";

/** The review history of one item of the affaire's list, for any of its readers: newest first, by pages. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string; itemId: string }> }) {
  try {
    const { projectId, itemId } = await uuidRouteParamsOr404(params, "Poste introuvable.", "projectId", "itemId");
    const query = itemHistoryQuerySchema.safeParse(searchParamsObject(request));
    if (!query.success) throw unprocessableEntity("Page d’historique invalide.", undefined, "VALIDATION_ERROR");
    return ok(await readAffaireItemHistory(projectId, itemId.toLowerCase(), query.data));
  } catch (error) {
    return toErrorResponse(error);
  }
}
