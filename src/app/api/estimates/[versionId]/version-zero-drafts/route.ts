import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { generateVersionZeroDraftSchema } from "@/lib/estimates/schemas";
import {
  fetchVersionZeroDraftSummary,
  generateVersionZeroDraft,
} from "@/lib/estimates/version-zero-drafts";
import { parseJsonBody } from "@/lib/http/request";

const paramsSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  return paramsSchema.parse(await paramsPromise).versionId;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const data = await fetchVersionZeroDraftSummary({ versionId });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const body = generateVersionZeroDraftSchema.parse(await parseJsonBody(request, badRequest));
    const data = await generateVersionZeroDraft({
      versionId,
      briefId: body.brief_id ?? null,
      selectedLots: body.selected_lots,
    });
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
