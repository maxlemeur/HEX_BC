import { z } from "zod";

import { badRequest, notFound, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";
import { itemSelectionRequestSchema } from "@/lib/takeoff/item-table-contracts";
import { freezeAffaireItemSelection } from "@/lib/takeoff/item-table-server";

const paramsSchema = z.object({ projectId: z.string().uuid() });

/** The frozen selection of a filter (every result, beyond the page shown) or of ticked items, with the revisions to name. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) throw notFound("Affaire introuvable.");
    const body = itemSelectionRequestSchema.safeParse(await parseJsonBody(request, badRequest));
    if (!body.success) throw unprocessableEntity("Sélection invalide.", undefined, "VALIDATION_ERROR");
    const { scope, selection } = body.data;
    return ok(await freezeAffaireItemSelection(parsed.data.projectId, {
      scope,
      selection: selection.kind === "filter" ? selection : { kind: "items", itemIds: selection.item_ids.map((id) => id.toLowerCase()) },
    }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
