import { ok } from "@/lib/estimates/errors";
import { labErrorResponse, requireTakeoffLabAccess } from "@/lib/takeoff/lab/server";
import { requireLabPaths } from "@/lib/takeoff/lab/storage";
import { readLabCampaign } from "@/lib/takeoff/lab/verdicts";

/** Every element of the campaign with its verdict, oldest essai first. */
export async function GET(_request: Request, { params }: { params: Promise<{ campaign: string }> }) {
  try {
    await requireTakeoffLabAccess();
    return ok(await readLabCampaign(await requireLabPaths(), (await params).campaign));
  } catch (error) {
    return labErrorResponse(error);
  }
}
