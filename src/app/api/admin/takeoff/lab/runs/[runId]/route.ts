import { readLabRun } from "@/lib/takeoff/lab/runs";
import { labErrorResponse, labOk, requireTakeoffLabAccess } from "@/lib/takeoff/lab/server";
import { requireLabPaths } from "@/lib/takeoff/lab/storage";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    await requireTakeoffLabAccess();
    return labOk(await readLabRun(await requireLabPaths(), (await params).runId));
  } catch (error) {
    return labErrorResponse(error);
  }
}
