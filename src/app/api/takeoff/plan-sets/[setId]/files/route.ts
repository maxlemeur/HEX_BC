import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import {
  createPlanFile,
  listPlanFiles,
  parseCreatePlanFileInput,
  parseListPlanFilesQuery,
  planSetIdSchema,
} from "@/lib/takeoff/plans";
import { parseJsonBody, searchParamsObject } from "@/lib/http/request";

const paramsSchema = z
  .object({
    setId: planSetIdSchema,
  })
  .strict();

async function getSetId(paramsPromise: Promise<{ setId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).setId;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ setId: string }> }
) {
  try {
    const setId = await getSetId(params);
    const query = parseListPlanFilesQuery(searchParamsObject(request));
    const data = await listPlanFiles({
      setId,
      includeDownloadUrl: query.include_download_url,
    });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ setId: string }> }
) {
  try {
    const setId = await getSetId(params);
    const payload = parseCreatePlanFileInput(await parseJsonBody(request, badRequest));
    const data = await createPlanFile(setId, payload);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
