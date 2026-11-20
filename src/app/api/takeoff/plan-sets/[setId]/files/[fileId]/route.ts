import { z } from "zod";

import { ok, toErrorResponse } from "@/lib/http/api-response";
import {
  deletePlanFile,
  getPlanFileDetail,
  parseGetPlanFileDetailQuery,
  planFileIdSchema,
  planSetIdSchema,
} from "@/lib/takeoff/plans";
import { searchParamsObject } from "@/lib/http/request";

const paramsSchema = z
  .object({
    setId: planSetIdSchema,
    fileId: planFileIdSchema,
  })
  .strict();

async function getParams(paramsPromise: Promise<{ setId: string; fileId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ setId: string; fileId: string }> }
) {
  try {
    const { setId, fileId } = await getParams(params);
    const query = parseGetPlanFileDetailQuery(searchParamsObject(request));
    const data = await getPlanFileDetail({
      setId,
      fileId,
      includeDownloadUrl: query.include_download_url,
    });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ setId: string; fileId: string }> }
) {
  try {
    const { setId, fileId } = await getParams(params);
    const data = await deletePlanFile(setId, fileId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
