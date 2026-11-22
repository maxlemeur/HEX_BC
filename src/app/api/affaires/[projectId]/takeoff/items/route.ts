import { z } from "zod";

import { notFound, ok, toErrorResponse } from "@/lib/http/api-response";
import { readItemTableAddress } from "@/lib/takeoff/item-table-query";
import { readAffaireItemTable } from "@/lib/takeoff/item-table-server";

const paramsSchema = z.object({ projectId: z.string().uuid() });

/** A page of the affaire's table of items, for any of its readers: scope, filters, page and focus from the address. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) throw notFound("Affaire introuvable.");
    return ok(await readAffaireItemTable(parsed.data.projectId, readItemTableAddress(new URL(request.url).searchParams)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
