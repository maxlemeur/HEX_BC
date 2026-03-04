import { z } from "zod";

import {
  forbidden,
  notFound,
  ok,
  toErrorResponse,
} from "@/lib/estimates/errors";
import { getAuthenticatedContext } from "@/lib/estimates/server";

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

    const { supabase, tenantId } = await getAuthenticatedContext();

    // Fetch the project and its version statuses in one go
    const { data: project, error: projectError } = await supabase
      .from("estimate_projects")
      .select("id, tenant_id, is_archived, estimate_versions(status)")
      .eq("id", projectId)
      .eq("tenant_id", tenantId)
      .single();

    if (projectError || !project) {
      throw notFound("Affaire introuvable.");
    }

    if (project.is_archived) {
      throw forbidden("Impossible de supprimer une affaire archivee.");
    }

    // All versions must be draft (or no versions at all)
    const versions = project.estimate_versions as { status: string }[];
    const hasNonDraft = versions.some((v) => v.status !== "draft");
    if (hasNonDraft) {
      throw forbidden(
        "Seules les affaires dont toutes les versions sont en brouillon peuvent etre supprimees."
      );
    }

    const { error: deleteError } = await supabase
      .from("estimate_projects")
      .delete()
      .eq("id", projectId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    return ok({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
