import {
  forbidden,
  internalError,
  notFound,
  ok,
  toErrorResponse,
} from "@/lib/http/api-response";
import { uuidRouteParamsOr404 } from "@/lib/http/request";
import { bulkDeleteDraftAffaires } from "@/lib/affaires/delete-server";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await uuidRouteParamsOr404(params, "Affaire introuvable.", "projectId");

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
