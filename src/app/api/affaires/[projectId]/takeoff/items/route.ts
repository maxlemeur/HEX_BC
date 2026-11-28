import { ok, toErrorResponse } from "@/lib/http/api-response";
import { uuidRouteParamsOr404 } from "@/lib/http/request";
import { readItemTableAddress } from "@/lib/takeoff/item-table-query";
import { readAffaireItemTable } from "@/lib/takeoff/item-table-server";

/** A page of the affaire's table of items, for any of its readers: scope, filters, page and focus from the address. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await uuidRouteParamsOr404(params, "Affaire introuvable.", "projectId");
    const query = new URL(request.url).searchParams;
    return ok(await readAffaireItemTable(projectId, readItemTableAddress(query), query.get("detail") === "1"));
  } catch (error) {
    return toErrorResponse(error);
  }
}
