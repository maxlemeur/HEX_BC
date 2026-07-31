import { z } from "zod";

import { mapSupabaseError } from "@/lib/estimates/errors";
import { getAuthenticatedContext } from "@/lib/estimates/server";
import { assertCanWriteEstimateWorkflows } from "@/lib/estimates/write-access";

export const bulkDeleteAffairesInputSchema = z.object({
  projectIds: z
    .array(z.string().uuid("ID projet invalide."))
    .min(1, "Selection vide.")
    .max(100, "La suppression est limitee a 100 affaires par lot.")
    .transform((projectIds) => [...new Set(projectIds)]),
});

export type BulkDeleteAffaireFailure = {
  projectId: string;
  reason: "not_found" | "not_eligible" | "failed";
  message: string;
};

export type BulkDeleteAffairesResult = {
  requestedCount: number;
  deletedIds: string[];
  failures: BulkDeleteAffaireFailure[];
};

export async function bulkDeleteDraftAffaires(
  projectIds: string[]
): Promise<BulkDeleteAffairesResult> {
  const { projectIds: uniqueProjectIds } = bulkDeleteAffairesInputSchema.parse({
    projectIds,
  });
  const context = await getAuthenticatedContext();
  assertCanWriteEstimateWorkflows(context.tenantRole);

  const { data, error } = await context.supabase.rpc("bulk_delete_draft_affaires", {
    p_tenant_id: context.tenantId,
    p_project_ids: uniqueProjectIds,
  });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de supprimer les affaires selectionnees."
    );
  }

  const rows = data ?? [];
  const deletedIds: string[] = [];
  const failures: BulkDeleteAffaireFailure[] = [];

  for (const row of rows) {
    if (row.outcome === "deleted") {
      deletedIds.push(row.project_id);
      continue;
    }

    const reason =
      row.outcome === "not_found" || row.outcome === "not_eligible"
        ? row.outcome
        : "failed";
    failures.push({
      projectId: row.project_id,
      reason,
      message: row.message ?? "Impossible de supprimer cette affaire.",
    });
  }

  const returnedIds = new Set(rows.map((row) => row.project_id));
  for (const projectId of uniqueProjectIds) {
    if (!returnedIds.has(projectId)) {
      failures.push({
        projectId,
        reason: "failed",
        message: "Aucun resultat de suppression n'a ete retourne.",
      });
    }
  }

  return {
    requestedCount: uniqueProjectIds.length,
    deletedIds,
    failures,
  };
}
