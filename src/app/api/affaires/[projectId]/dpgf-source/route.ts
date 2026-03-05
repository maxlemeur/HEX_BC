import { z } from "zod";

import { notFound, ok, toErrorResponse } from "@/lib/estimates/errors";
import { getAffaireLinkedDpgfSource } from "@/lib/estimates/server";

const paramsSchema = z.object({
  projectId: z.string().uuid("ID projet invalide."),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) {
      throw notFound("Affaire introuvable.");
    }

    const data = await getAffaireLinkedDpgfSource(parsed.data.projectId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
