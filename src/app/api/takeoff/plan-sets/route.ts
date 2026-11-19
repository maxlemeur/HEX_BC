import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import {
  createPlanSet,
  parseCreatePlanSetInput,
  parseListPlanSetsQuery,
  listPlanSets,
} from "@/lib/takeoff/plans";
import { parseJsonBody, searchParamsObject } from "@/lib/http/request";

export async function GET(request: Request) {
  try {
    const query = parseListPlanSetsQuery(searchParamsObject(request));
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
