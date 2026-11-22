import { z } from "zod";

import { badRequest, notFound, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";
import { itemListAddRequestSchema } from "@/lib/takeoff/item-list-contracts";
import { addItemListPoste } from "@/lib/takeoff/item-list-server";

const paramsSchema = z.object({ projectId: z.string().uuid() });

/** Add an item to the affaire's list by hand, at any date; the same intention key replays the same addition. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) throw notFound("Affaire introuvable.");
    const body = itemListAddRequestSchema.safeParse(await parseJsonBody(request, badRequest));
    if (!body.success) {
      throw unprocessableEntity(body.error.issues[0]?.message ?? "Poste invalide.", undefined, "VALIDATION_ERROR");
    }
    const { qualifiers } = body.data;
    return ok(await addItemListPoste(parsed.data.projectId, {
      expectedRevision: body.data.expected_revision, intentKey: body.data.intent_key, label: body.data.label,
      expectedUnit: body.data.expected_unit, measurementBasis: body.data.measurement_basis,
      qualifiers: Object.fromEntries(Object.entries(qualifiers).filter(([, value]) => value)),
      sectionOfItemId: body.data.section_of_item_id ?? null,
    }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
