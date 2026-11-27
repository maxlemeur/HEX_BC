import { ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { uuidRouteParamsOr404 } from "@/lib/http/request";
import { countMarkTargetsQuerySchema } from "@/lib/takeoff/count-marks-contracts";
import { readCountMarkTargets } from "@/lib/takeoff/count-marks-server";

/** The items a mark of an answer may be given to, for any reader of the affaire: the other items of the same reading. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await uuidRouteParamsOr404(params, "Affaire introuvable.", "projectId");
    const query = countMarkTargetsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw unprocessableEntity("Réponse de repères invalide.", undefined, "VALIDATION_ERROR");
    return ok(await readCountMarkTargets(projectId, { answerId: query.data.reponse }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
