import { z } from "zod";

import { badRequest, notFound, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";
import { itemReviewCommandSchema } from "@/lib/takeoff/item-table-contracts";
import { runItemReviewCommand } from "@/lib/takeoff/item-review-commands-server";

const paramsSchema = z.object({ projectId: z.string().uuid() });

/** A review command on a frozen selection: accept, set aside, reinstate, enter quantities, include an entered hypothesis. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) throw notFound("Affaire introuvable.");
    const body = itemReviewCommandSchema.safeParse(await parseJsonBody(request, badRequest));
    if (!body.success) {
      throw unprocessableEntity(body.error.issues[0]?.message ?? "Commande de revue invalide.", undefined, "VALIDATION_ERROR");
    }
    return ok(await runItemReviewCommand(parsed.data.projectId, body.data));
  } catch (error) {
    return toErrorResponse(error);
  }
}
