import { z } from "zod";

import {
  forbidden,
  internalError,
  notFound,
  ok,
  toErrorResponse,
} from "@/lib/estimates/errors";
import { bulkDeleteDraftAffaires } from "@/lib/affaires/delete-server";

const paramsSchema = z.object({
  projectId: z.string().uuid("ID projet invalide."),
});

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) {
      throw notFound("Affaire introuvable.");
    }
    const { projectId } = parsed.data;

    const result = await bulkDeleteDraftAffaires([projectId]);
    if (!result.deletedIds.includes(projectId)) {
      const failure = result.failures.find((entry) => entry.projectId === projectId);
      if (failure?.reason === "not_found") {
        throw notFound("Affaire introuvable.");
      }
      if (failure?.reason === "not_eligible") {
        throw forbidden(failure.message);
      }
      throw internalError(failure?.message ?? "Impossible de supprimer l'affaire.");
    }

    return ok({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
