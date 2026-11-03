import { badRequest, ok } from "@/lib/estimates/errors";
import { LAB_NAME_PATTERN, LabRunRequestSchema } from "@/lib/takeoff/lab/contracts";
import { executeLabRun, listLabRuns, summarizeLabRun } from "@/lib/takeoff/lab/runs";
import { labErrorResponse, requireTakeoffLabAccess, requireTakeoffLabWrite } from "@/lib/takeoff/lab/server";
import { requireLabPaths } from "@/lib/takeoff/lab/storage";

/** History of the essais, newest first, optionally for one campaign. */
export async function GET(request: Request) {
  try {
    await requireTakeoffLabAccess();
    const campaign = new URL(request.url).searchParams.get("campaign");
    if (campaign !== null && !LAB_NAME_PATTERN.test(campaign)) throw badRequest("Campagne invalide.");
    const runs = await listLabRuns(await requireLabPaths());
    return ok(runs.filter((run) => !campaign || run.campaign === campaign).map(summarizeLabRun));
  } catch (error) {
    return labErrorResponse(error);
  }
}

/** Runs one essai: one to four configurations, one after the other, stored before it answers. */
export async function POST(request: Request) {
  try {
    const access = await requireTakeoffLabWrite(request, { json: true });
    const body = LabRunRequestSchema.parse(await request.json().catch(() => {
      throw badRequest("Corps JSON invalide.");
    }));
    return ok(await executeLabRun(access, body), 201);
  } catch (error) {
    return labErrorResponse(error);
  }
}
