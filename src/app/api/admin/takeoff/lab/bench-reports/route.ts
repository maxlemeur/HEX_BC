import { ok } from "@/lib/estimates/errors";
import { listBenchReports } from "@/lib/takeoff/lab/bench-reports";
import { labErrorResponse, requireTakeoffLabAccess } from "@/lib/takeoff/lab/server";

/** The takeoff:bench reports (TI-660), read only. */
export async function GET() {
  try {
    await requireTakeoffLabAccess();
    const { reports } = await listBenchReports();
    return ok(reports);
  } catch (error) {
    return labErrorResponse(error);
  }
}
