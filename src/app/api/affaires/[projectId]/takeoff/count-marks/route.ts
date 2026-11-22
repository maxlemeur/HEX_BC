import { z } from "zod";

import { badRequest, notFound, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";
import { countMarksEditRequestSchema, countMarksQuerySchema } from "@/lib/takeoff/count-marks-contracts";
import { editCountMarksAsMember, readCountMarksView } from "@/lib/takeoff/count-marks-server";

const paramsSchema = z.object({ projectId: z.string().uuid() });

/**
 * The counted marks of one answer on one page of its plan, for any reader of the affaire: a page of marks (the server's
 * total apart from the number loaded), the answer's server-side count and what the member may do with them.
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) throw notFound("Affaire introuvable.");
    const query = countMarksQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw unprocessableEntity("Page de repères invalide.", undefined, "VALIDATION_ERROR");
    return ok(await readCountMarksView(parsed.data.projectId, { answerId: query.data.reponse, page: query.data.page,
      states: query.data.etats, afterMarkId: query.data.apres ?? null, limit: query.data.limite }));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** An operator's correction of marks: N gestures in one command, under the expected revisions and an intention key. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) throw notFound("Affaire introuvable.");
    const body = countMarksEditRequestSchema.safeParse(await parseJsonBody(request, badRequest));
    if (!body.success) throw unprocessableEntity("Modification de repères invalide.", undefined, "TAKEOFF_MARKS_INVALID");
    return ok(await editCountMarksAsMember(parsed.data.projectId, body.data));
  } catch (error) {
    return toErrorResponse(error);
  }
}
