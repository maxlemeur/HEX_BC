import { badRequest, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { parseJsonBody, uuidRouteParamsOr404 } from "@/lib/http/request";
import { itemReviewCommandSchema } from "@/lib/takeoff/item-table-contracts";
import { runItemReviewCommand } from "@/lib/takeoff/item-review-commands-server";

/** A review command on a frozen selection: accept, set aside, reinstate, enter quantities, include an entered hypothesis. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await uuidRouteParamsOr404(params, "Affaire introuvable.", "projectId");
    const body = itemReviewCommandSchema.safeParse(await parseJsonBody(request, badRequest));
    if (!body.success) {
      throw unprocessableEntity(body.error.issues[0]?.message ?? "Commande de revue invalide.", undefined, "VALIDATION_ERROR");
    }
    return ok(await runItemReviewCommand(projectId, body.data));
  } catch (error) {
    return toErrorResponse(error);
  }
}
