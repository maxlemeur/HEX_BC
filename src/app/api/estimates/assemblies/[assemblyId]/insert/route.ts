import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { insertAssemblyIntoVersionSchema } from "@/lib/estimates/schemas";
import { insertAssemblyIntoVersion } from "@/lib/estimates/server";

const paramsSchema = z.object({
  assemblyId: z.string().uuid("assemblyId invalide."),
});

async function getAssemblyId(paramsPromise: Promise<{ assemblyId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).assemblyId;
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
  { params }: { params: Promise<{ assemblyId: string }> }
) {
  try {
    const assemblyId = await getAssemblyId(params);
    const { searchParams } = new URL(request.url);
    const body = await parseOptionalJsonBody(request);

    const payload = insertAssemblyIntoVersionSchema.parse({
      versionId: searchParams.get("versionId"),
      ...(body && typeof body === "object" ? body : {}),
    });

    const data = await insertAssemblyIntoVersion({
      assemblyId,
      versionId: payload.version_id,
      afterItemId: payload.after_item_id ?? null,
    });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
