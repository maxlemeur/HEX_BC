import { ok } from "@/lib/estimates/errors";
import { labErrorResponse, requireTakeoffLabWrite } from "@/lib/takeoff/lab/server";
import { requireLabPaths } from "@/lib/takeoff/lab/storage";
import { undoLabVerdict } from "@/lib/takeoff/lab/verdicts";

/** « Annuler » : deletes the author's latest verdict in the campaign. */
export async function POST(request: Request, { params }: { params: Promise<{ campaign: string }> }) {
  try {
    const access = await requireTakeoffLabWrite(request, { json: false });
    return ok(await undoLabVerdict(await requireLabPaths(), access, (await params).campaign));
  } catch (error) {
    return labErrorResponse(error);
  }
}
