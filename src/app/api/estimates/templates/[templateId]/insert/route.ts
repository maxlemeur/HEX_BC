import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { insertTemplateIntoVersionSchema } from "@/lib/estimates/schemas";
import { insertTemplateIntoVersion } from "@/lib/estimates/server";

const paramsSchema = z.object({
  templateId: z.string().uuid("templateId invalide."),
});

async function getTemplateId(paramsPromise: Promise<{ templateId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).templateId;
}

async function parseOptionalJsonBody(request: Request): Promise<unknown> {
  try {
    const raw = await request.text();
    if (!raw.trim()) {
      return {};
    }
    return JSON.parse(raw);
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const templateId = await getTemplateId(params);
    const { searchParams } = new URL(request.url);
    const body = await parseOptionalJsonBody(request);

    const payload = insertTemplateIntoVersionSchema.parse({
      versionId: searchParams.get("versionId"),
      ...(body && typeof body === "object" ? body : {}),
    });

    const data = await insertTemplateIntoVersion({
      templateId,
      versionId: payload.version_id,
      afterItemId: payload.after_item_id ?? null,
    });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
