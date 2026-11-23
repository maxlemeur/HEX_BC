import { z } from "zod";

import { notFound, ok, toErrorResponse } from "@/lib/http/api-response";
import { readAffaireItemLine } from "@/lib/takeoff/item-table-server";

const paramsSchema = z.object({ projectId: z.string().uuid(), itemId: z.string().uuid() });

/** One item of the affaire's list on its own, outside any filter (a link of the radar, the detail of an item). */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string; itemId: string }> }) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) throw notFound("Poste introuvable.");
    const line = await readAffaireItemLine(parsed.data.projectId, parsed.data.itemId.toLowerCase(), new URL(request.url).searchParams.get("detail") === "1");
    if (!line) throw notFound("Ce poste n’est pas dans la liste de l’affaire.");
    return ok(line);
  } catch (error) {
    return toErrorResponse(error);
  }
}
