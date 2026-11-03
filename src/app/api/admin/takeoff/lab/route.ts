import { ok } from "@/lib/estimates/errors";
import { labErrorResponse, readLabState, requireTakeoffLabAccess } from "@/lib/takeoff/lab/server";

/** Takeoff lab (TI-661): configuration, documents, tasks, Decisions budget and campaigns. */
export async function GET() {
  try {
    return ok(await readLabState(await requireTakeoffLabAccess()));
  } catch (error) {
    return labErrorResponse(error);
  }
}
