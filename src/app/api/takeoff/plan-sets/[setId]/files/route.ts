import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import {
  createPlanFile,
  listPlanFiles,
  parseCreatePlanFileInput,
  parseListPlanFilesQuery,
  planSetIdSchema,
} from "@/lib/takeoff/plans";

const paramsSchema = z
  .object({
    setId: planSetIdSchema,
  })
  .strict();

async function getSetId(paramsPromise: Promise<{ setId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).setId;
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

function toQueryObject(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ setId: string }> }
) {
  try {
    const setId = await getSetId(params);
    const query = parseListPlanFilesQuery(toQueryObject(request));
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
    const payload = parseCreatePlanFileInput(await parseJsonBody(request));
    const data = await createPlanFile(setId, payload);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
