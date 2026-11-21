import { z } from "zod";

import { notFound, ok, toErrorResponse } from "@/lib/http/api-response";
import { loadAffaireItemList } from "@/lib/takeoff/item-list-server";

const paramsSchema = z.object({ projectId: z.string().uuid() });

/** The affaire's item list, for any of its readers: stored revision, history, sources and the proposed revision. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) throw notFound("Affaire introuvable.");
    return ok(await loadAffaireItemList(parsed.data.projectId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
