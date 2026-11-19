import { labErrorResponse, labOk, readLabState, requireTakeoffLabAccess } from "@/lib/takeoff/lab/server";

/** Takeoff lab (TI-661): configuration, documents, tasks, Decisions budget and campaigns. */
export async function GET() {
  try {
    return labOk(await readLabState(await requireTakeoffLabAccess()));
  } catch (error) {
    return labErrorResponse(error);
  }
}
