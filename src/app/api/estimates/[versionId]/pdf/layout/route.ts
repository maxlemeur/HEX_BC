import { z } from "zod";

import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { getEstimatePdfLayoutConfiguration } from "@/lib/estimates/pdf-generator";

export const runtime = "nodejs";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const { versionId } = versionIdParamSchema.parse(await params);
    return ok(await getEstimatePdfLayoutConfiguration(versionId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
