import { badRequest, ok } from "@/lib/estimates/errors";
import { LabVerdictRequestSchema } from "@/lib/takeoff/lab/contracts";
import { labErrorResponse, requireTakeoffLabWrite } from "@/lib/takeoff/lab/server";
import { requireLabPaths } from "@/lib/takeoff/lab/storage";
import { saveLabVerdict } from "@/lib/takeoff/lab/verdicts";

/** Records (or replaces) the verdict of one element of the campaign. */
export async function PUT(request: Request, { params }: { params: Promise<{ campaign: string; elementId: string }> }) {
  try {
    const access = await requireTakeoffLabWrite(request, { json: true });
    const { campaign, elementId } = await params;
    const body = LabVerdictRequestSchema.parse(await request.json().catch(() => {
      throw badRequest("Corps JSON invalide.");
    }));
    return ok(await saveLabVerdict(await requireLabPaths(), access, campaign, elementId, body.verdict));
  } catch (error) {
    return labErrorResponse(error);
  }
}
