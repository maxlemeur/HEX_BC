import { z } from "zod";

import { notFound, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { countMarkTargetsQuerySchema } from "@/lib/takeoff/count-marks-contracts";
import { readCountMarkTargets } from "@/lib/takeoff/count-marks-server";

const paramsSchema = z.object({ projectId: z.string().uuid() });

/** The items a mark of an answer may be given to, for any reader of the affaire: the other items of the same reading. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) throw notFound("Affaire introuvable.");
    const query = countMarkTargetsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw unprocessableEntity("Réponse de repères invalide.", undefined, "VALIDATION_ERROR");
    return ok(await readCountMarkTargets(parsed.data.projectId, { answerId: query.data.reponse }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
