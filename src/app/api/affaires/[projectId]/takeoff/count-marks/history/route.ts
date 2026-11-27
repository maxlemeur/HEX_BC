import { ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { uuidRouteParamsOr404 } from "@/lib/http/request";
import { countMarksHistoryQuerySchema } from "@/lib/takeoff/count-marks-contracts";
import { readCountMarksHistory } from "@/lib/takeoff/count-marks-server";

/** The journal of an answer's marks, for any reader of the affaire: in order, by pages, after the position given. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await uuidRouteParamsOr404(params, "Affaire introuvable.", "projectId");
    const query = countMarksHistoryQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw unprocessableEntity("Page d’historique de repères invalide.", undefined, "VALIDATION_ERROR");
    const { reponse, apresRevision, apresOrdre, limite } = query.data;
    return ok(await readCountMarksHistory(projectId, { answerId: reponse, limit: limite,
      after: apresRevision !== undefined || apresOrdre !== undefined ? { revision: apresRevision ?? 0, ordinal: apresOrdre ?? 0 } : null }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
