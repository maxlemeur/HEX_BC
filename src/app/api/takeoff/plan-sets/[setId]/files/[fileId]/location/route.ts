import { badRequest, ok } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import { readTakeoffPlanFileLocation, saveTakeoffPlanFileLocation } from "@/lib/takeoff/plan-location-server";

type Params = { params: Promise<{ setId: string; fileId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    return ok(await readTakeoffPlanFileLocation(await params));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const body = await parseJsonBody(request, badRequest);
    return ok(await saveTakeoffPlanFileLocation({ ...(await params), body }));
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
