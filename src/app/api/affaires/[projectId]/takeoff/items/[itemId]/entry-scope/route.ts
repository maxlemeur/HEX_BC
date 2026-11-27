import { badRequest, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { parseJsonBody, uuidRouteParamsOr404 } from "@/lib/http/request";
import { entryScopeCommandSchema } from "@/lib/takeoff/entry-scope-contracts";
import { changeEntryScope } from "@/lib/takeoff/entry-scope-server";

export async function POST(request: Request, ctx: { params: Promise<{ projectId: string; itemId: string }> }) {
  try {
    const params = await uuidRouteParamsOr404(ctx.params, "Poste introuvable.", "projectId", "itemId");
    const body = entryScopeCommandSchema.safeParse(await parseJsonBody(request, badRequest));
    if (!body.success) throw unprocessableEntity("Changement de portée invalide.");
    return ok(await changeEntryScope(params.projectId, params.itemId, body.data));
  } catch (error) { return toErrorResponse(error); }
}
