import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { recoverTakeoffRules } from "@/lib/takeoff/rules/recovery-server";

export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    return ok(await recoverTakeoffRules((await params).jobId));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
