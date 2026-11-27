import { notFound, ok, toErrorResponse } from "@/lib/http/api-response";
import { uuidRouteParamsOr404 } from "@/lib/http/request";
import { readAffaireItemLine } from "@/lib/takeoff/item-table-server";

/** One item of the affaire's list on its own, outside any filter (a link of the radar, the detail of an item). */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string; itemId: string }> }) {
  try {
    const { projectId, itemId } = await uuidRouteParamsOr404(params, "Poste introuvable.", "projectId", "itemId");
    const line = await readAffaireItemLine(projectId, itemId.toLowerCase(), new URL(request.url).searchParams.get("detail") === "1");
    if (!line) throw notFound("Ce poste n’est pas dans la liste de l’affaire.");
    return ok(line);
  } catch (error) {
    return toErrorResponse(error);
  }
}
