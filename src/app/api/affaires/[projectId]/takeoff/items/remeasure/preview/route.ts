import { z } from "zod";

import { badRequest, notFound, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";
import { itemRemeasurePreviewRequestSchema } from "@/lib/takeoff/item-table-contracts";
import { previewItemRemeasure } from "@/lib/takeoff/item-review-commands-server";

const paramsSchema = z.object({ projectId: z.string().uuid() });

/** What a new measure of the selection would ask and who would pay, before its confirmation. Reads only. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) throw notFound("Affaire introuvable.");
    const body = itemRemeasurePreviewRequestSchema.safeParse(await parseJsonBody(request, badRequest));
    if (!body.success) throw unprocessableEntity("Sélection invalide.", undefined, "VALIDATION_ERROR");
    return ok(await previewItemRemeasure(parsed.data.projectId, {
      scope: body.data.scope, itemIds: body.data.item_ids.map((id) => id.toLowerCase()), seen: body.data.seen, detail: body.data.detail, fromFinds: body.data.from_finds,
      ...(body.data.payment_choice && { paymentChoice: body.data.payment_choice }),
    }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
