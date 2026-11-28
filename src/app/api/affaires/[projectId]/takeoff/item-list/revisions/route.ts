import { badRequest, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { parseJsonBody, uuidRouteParamsOr404 } from "@/lib/http/request";
import { itemListAcceptRequestSchema } from "@/lib/takeoff/item-list-contracts";
import { acceptItemListProposal } from "@/lib/takeoff/item-list-server";

/** Accept the revision the affaire's sources propose, as the operator saw it, with the continuities they confirmed. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await uuidRouteParamsOr404(params, "Affaire introuvable.", "projectId");
    const body = itemListAcceptRequestSchema.safeParse(await parseJsonBody(request, badRequest));
    if (!body.success) throw unprocessableEntity("Demande invalide : rechargez la liste des postes.", undefined, "VALIDATION_ERROR");
    return ok(await acceptItemListProposal(projectId, {
      expectedRevision: body.data.expected_revision, proposalDigest: body.data.proposal_digest, intentKey: body.data.intent_key,
      continuities: body.data.continuities.map(({ previous_item_id, next_item_id }) =>
        ({ previousItemId: previous_item_id, nextItemId: next_item_id })),
    }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
