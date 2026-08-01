import { z } from "zod";

import { mapSupabaseError } from "@/lib/estimates/errors";
import { getAuthenticatedContext } from "@/lib/estimates/server";
import { assertCanWriteEstimateWorkflows } from "@/lib/estimates/write-access";
import type { Database } from "@/types/database";

export const BULK_DELETE_AFFAIRES_MAX = 1000;
const BULK_DELETE_AFFAIRES_RPC_BATCH_SIZE = 100;

type BulkDeleteDraftAffairesRpcRow =
  Database["public"]["Functions"]["bulk_delete_draft_affaires"]["Returns"][number];
type BulkArchiveDraftAffairesRpcRow =
  Database["public"]["Functions"]["bulk_archive_draft_affaires"]["Returns"][number];

export const bulkDeleteAffairesInputSchema = z.object({
  projectIds: z
    .array(z.string().uuid("ID projet invalide."))
    .min(1, "Selection vide.")
    .max(
      BULK_DELETE_AFFAIRES_MAX,
      "La suppression est limitee a 1 000 affaires par lot.",
    )
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

export type BulkArchiveAffairesResult = {
  requestedCount: number;
  archivedIds: string[];
  failures: BulkDeleteAffaireFailure[];
};

export async function bulkDeleteDraftAffaires(
  projectIds: string[],
): Promise<BulkDeleteAffairesResult> {
  const { projectIds: uniqueProjectIds } = bulkDeleteAffairesInputSchema.parse({
    projectIds,
  });
  const context = await getAuthenticatedContext();
  assertCanWriteEstimateWorkflows(context.tenantRole);

  const rows: BulkDeleteDraftAffairesRpcRow[] = [];
  const rpcFailures: BulkDeleteAffaireFailure[] = [];

  for (
    let offset = 0;
    offset < uniqueProjectIds.length;
    offset += BULK_DELETE_AFFAIRES_RPC_BATCH_SIZE
  ) {
    const batchProjectIds = uniqueProjectIds.slice(
      offset,
      offset + BULK_DELETE_AFFAIRES_RPC_BATCH_SIZE,
    );
    const { data, error } = await context.supabase.rpc(
      "bulk_delete_draft_affaires",
      {
        p_tenant_id: context.tenantId,
        p_project_ids: batchProjectIds,
      },
    );

    if (error) {
      const mappedError = mapSupabaseError(
        error,
        "Impossible de supprimer les affaires selectionnees.",
      );
      if (offset === 0) {
        throw mappedError;
      }

      for (const projectId of uniqueProjectIds.slice(offset)) {
        rpcFailures.push({
          projectId,
          reason: "failed",
          message: mappedError.message,
        });
      }
      break;
    }

    rows.push(...(data ?? []));
  }

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

  failures.push(...rpcFailures);

  const returnedIds = new Set([
    ...rows.map((row) => row.project_id),
    ...rpcFailures.map((failure) => failure.projectId),
  ]);
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

export async function bulkArchiveDraftAffaires(
  projectIds: string[],
): Promise<BulkArchiveAffairesResult> {
  const { projectIds: uniqueProjectIds } = bulkDeleteAffairesInputSchema.parse({
    projectIds,
  });
  const context = await getAuthenticatedContext();
  assertCanWriteEstimateWorkflows(context.tenantRole);

  const rows: BulkArchiveDraftAffairesRpcRow[] = [];
  const rpcFailures: BulkDeleteAffaireFailure[] = [];

  for (
    let offset = 0;
    offset < uniqueProjectIds.length;
    offset += BULK_DELETE_AFFAIRES_RPC_BATCH_SIZE
  ) {
    const batchProjectIds = uniqueProjectIds.slice(
      offset,
      offset + BULK_DELETE_AFFAIRES_RPC_BATCH_SIZE,
    );
    const { data, error } = await context.supabase.rpc(
      "bulk_archive_draft_affaires",
      {
        p_tenant_id: context.tenantId,
        p_project_ids: batchProjectIds,
      },
    );

    if (error) {
      const mappedError = mapSupabaseError(
        error,
        "Impossible d'archiver les affaires selectionnees.",
      );
      if (offset === 0) {
        throw mappedError;
      }

      for (const projectId of uniqueProjectIds.slice(offset)) {
        rpcFailures.push({
          projectId,
          reason: "failed",
          message: mappedError.message,
        });
      }
      break;
    }

    rows.push(...(data ?? []));
  }

  const archivedIds: string[] = [];
  const failures: BulkDeleteAffaireFailure[] = [];

  for (const row of rows) {
    if (row.outcome === "archived") {
      archivedIds.push(row.project_id);
      continue;
    }

    const reason =
      row.outcome === "not_found" || row.outcome === "not_eligible"
        ? row.outcome
        : "failed";
    failures.push({
      projectId: row.project_id,
      reason,
      message: row.message ?? "Impossible d'archiver cette affaire.",
    });
  }

  failures.push(...rpcFailures);

  const returnedIds = new Set([
    ...rows.map((row) => row.project_id),
    ...rpcFailures.map((failure) => failure.projectId),
  ]);
  for (const projectId of uniqueProjectIds) {
    if (!returnedIds.has(projectId)) {
      failures.push({
        projectId,
        reason: "failed",
        message: "Aucun resultat d'archivage n'a ete retourne.",
      });
    }
  }

  return {
    requestedCount: uniqueProjectIds.length,
    archivedIds,
    failures,
  };
}