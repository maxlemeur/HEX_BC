import { z } from "zod";

import { badRequest, notFound, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";
import { itemListAcceptRequestSchema } from "@/lib/takeoff/item-list-contracts";
import { acceptItemListProposal } from "@/lib/takeoff/item-list-server";

const paramsSchema = z.object({ projectId: z.string().uuid() });

/** Accept the revision the affaire's sources propose, as the operator saw it, with the continuities they confirmed. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) throw notFound("Affaire introuvable.");
    const body = itemListAcceptRequestSchema.safeParse(await parseJsonBody(request, badRequest));
    if (!body.success) throw unprocessableEntity("Demande invalide : rechargez la liste des postes.", undefined, "VALIDATION_ERROR");
    return ok(await acceptItemListProposal(parsed.data.projectId, {
      expectedRevision: body.data.expected_revision, proposalDigest: body.data.proposal_digest, intentKey: body.data.intent_key,
      continuities: body.data.continuities.map(({ previous_item_id, next_item_id }) =>
        ({ previousItemId: previous_item_id, nextItemId: next_item_id })),
    }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
