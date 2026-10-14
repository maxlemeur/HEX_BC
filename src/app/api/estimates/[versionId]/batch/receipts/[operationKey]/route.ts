import { z } from "zod";

import { getEstimateBatchReceipt } from "@/lib/estimates/batch";
import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";

const paramsSchema = z.object({ versionId: z.string().uuid(), operationKey: z.string().uuid() }).strict();

export async function GET(request: Request, { params }: {
  params: Promise<{ versionId: string; operationKey: string }>;
}) {
  try {
    if (new URL(request.url).searchParams.size !== 0) throw badRequest("Paramètres de reçu invalides.");
    const { versionId, operationKey } = paramsSchema.parse(await params);
    const response = ok(await getEstimateBatchReceipt(versionId, operationKey));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
