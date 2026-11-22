import { z } from "zod";

import { notFound, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { countMarksHistoryQuerySchema } from "@/lib/takeoff/count-marks-contracts";
import { readCountMarksHistory } from "@/lib/takeoff/count-marks-server";

const paramsSchema = z.object({ projectId: z.string().uuid() });

/** The journal of an answer's marks, for any reader of the affaire: in order, by pages, after the position given. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) throw notFound("Affaire introuvable.");
    const query = countMarksHistoryQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw unprocessableEntity("Page d’historique de repères invalide.", undefined, "VALIDATION_ERROR");
    const { reponse, apresRevision, apresOrdre, limite } = query.data;
    return ok(await readCountMarksHistory(parsed.data.projectId, { answerId: reponse, limit: limite,
      after: apresRevision !== undefined || apresOrdre !== undefined ? { revision: apresRevision ?? 0, ordinal: apresOrdre ?? 0 } : null }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
