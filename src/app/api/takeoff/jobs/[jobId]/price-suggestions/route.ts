import { ok } from "@/lib/http/api-response";
import { toTakeoffRouteErrorResponse } from "@/lib/takeoff/errors";
import {
  getTakeoffPriceSuggestion,
  parseTakeoffPriceSuggestionQuery,
  requestTakeoffPriceSuggestion,
} from "@/lib/takeoff/server";
import { searchParamsObject } from "@/lib/http/request";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const jobId = (await params).jobId;
    const query = parseTakeoffPriceSuggestionQuery(searchParamsObject(request));
    const data = await getTakeoffPriceSuggestion(jobId, query);

    return ok(data);
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const jobId = (await params).jobId;
    const body = await request.json();
    const data = await requestTakeoffPriceSuggestion(jobId, body);

    return ok(data);
  } catch (error) {
    return toTakeoffRouteErrorResponse(error);
  }
}
