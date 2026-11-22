import { z } from "zod";

import { notFound, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { itemHistoryQuerySchema } from "@/lib/takeoff/item-table-contracts";
import { readAffaireItemHistory } from "@/lib/takeoff/item-table-server";

const paramsSchema = z.object({ projectId: z.string().uuid(), itemId: z.string().uuid() });

/** The review history of one item of the affaire's list, for any of its readers: newest first, by pages. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string; itemId: string }> }) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) throw notFound("Poste introuvable.");
    const query = itemHistoryQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw unprocessableEntity("Page d’historique invalide.", undefined, "VALIDATION_ERROR");
    return ok(await readAffaireItemHistory(parsed.data.projectId, parsed.data.itemId.toLowerCase(), query.data));
  } catch (error) {
    return toErrorResponse(error);
  }
}
