import { badRequest, ok } from "@/lib/estimates/errors";
import { LAB_NAME_PATTERN } from "@/lib/takeoff/lab/contracts";
import { labErrorResponse, requireTakeoffLabAccess } from "@/lib/takeoff/lab/server";
import { requireLabPaths } from "@/lib/takeoff/lab/storage";
import { computeLabStats } from "@/lib/takeoff/lab/verdicts";

/** % judged good per configuration and prompt version, with mean tokens and latency. */
export async function GET(request: Request) {
  try {
    await requireTakeoffLabAccess();
    const search = new URL(request.url).searchParams;
    const campaign = search.get("campaign") || null;
    const task = search.get("task") || null;
    if ((campaign && !LAB_NAME_PATTERN.test(campaign)) || (task && !LAB_NAME_PATTERN.test(task))) throw badRequest("Filtre invalide.");
    return ok(await computeLabStats(await requireLabPaths(), { campaign, task }));
  } catch (error) {
    return labErrorResponse(error);
  }
}
