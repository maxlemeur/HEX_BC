import { z } from "zod";

import { notFound, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { readItemDetailPlanRequest } from "@/lib/takeoff/item-detail-address";
import { resolveItemDetailPlan } from "@/lib/takeoff/item-detail-plan-server";

const paramsSchema = z.object({ projectId: z.string().uuid() });

/** The plan a detail of an item shows, for a reader of the affaire: a reading's sealed copy, or the dossier's current one. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) throw notFound("Affaire introuvable.");
    const plan = readItemDetailPlanRequest(new URL(request.url).searchParams);
    if (!plan) throw unprocessableEntity("Le plan demandé n’est pas désigné correctement.", undefined, "TAKEOFF_ITEM_DETAIL_ADDRESS_INVALID");
    return ok(await resolveItemDetailPlan(parsed.data.projectId, plan));
  } catch (error) {
    return toErrorResponse(error);
  }
}
