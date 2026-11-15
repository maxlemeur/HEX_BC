import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import {
  createPlanSet,
  parseCreatePlanSetInput,
  parseListPlanSetsQuery,
  listPlanSets,
} from "@/lib/takeoff/plans";
import { parseJsonBody } from "@/lib/http/request";

function toQueryObject(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

export async function GET(request: Request) {
  try {
    const query = parseListPlanSetsQuery(toQueryObject(request));
    const data = await listPlanSets(query);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = parseCreatePlanSetInput(await parseJsonBody(request, badRequest));
    const data = await createPlanSet(payload);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
