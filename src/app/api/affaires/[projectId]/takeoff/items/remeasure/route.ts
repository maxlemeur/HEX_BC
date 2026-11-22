import { z } from "zod";

import { badRequest, notFound, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";
import { itemRemeasureCommandSchema } from "@/lib/takeoff/item-table-contracts";
import { runItemRemeasure } from "@/lib/takeoff/item-review-commands-server";

const paramsSchema = z.object({ projectId: z.string().uuid() });

/** A new manual request of the member who confirms, on their own subscription, for the selection of the preview. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) throw notFound("Affaire introuvable.");
    const body = itemRemeasureCommandSchema.safeParse(await parseJsonBody(request, badRequest));
    if (!body.success) throw unprocessableEntity("Demande de nouvelle mesure invalide.", undefined, "VALIDATION_ERROR");
    return ok(await runItemRemeasure(parsed.data.projectId, {
      ...body.data, item_ids: body.data.item_ids.map((id) => id.toLowerCase()),
    }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
