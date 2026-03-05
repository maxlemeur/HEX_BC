import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { importLinkedDpgfSourceSchema } from "@/lib/estimates/schemas";
import { importLinkedDpgfSourceIntoVersion } from "@/lib/estimates/server";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return versionIdParamSchema.parse(params).versionId;
}

async function parseJsonBody(request: Request): Promise<unknown> {
  const rawBody = await request.text();
  if (rawBody.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const body = importLinkedDpgfSourceSchema.parse(await parseJsonBody(request));
    const data = await importLinkedDpgfSourceIntoVersion(versionId, body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
