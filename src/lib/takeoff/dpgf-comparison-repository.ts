import "server-only";

import { readAllRows } from "@/lib/supabase/read-all";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import type { AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { ESTIMATE_DPGF_COMPARE_SELECT } from "@/lib/takeoff/estimate-line-read-contract";
import {
  normalizeTakeoffDpgfEstimateItemRow,
  normalizeTakeoffDpgfManualLinkRows,
  normalizeTakeoffDpgfMappedRows,
  buildTakeoffDpgfReviewDecisionRecords,
  buildDpgfUnitByRowIndex,
  getCarriedOverVersionIds,
} from "@/lib/takeoff/dpgf-comparison-preparation";

export const TAKEOFF_DPGF_LINKS_SELECT = [
  "id",
  "tenant_id",
  "version_id",
  "takeoff_job_id",
  "estimate_item_id",
  "takeoff_item_id",
  "created_at",
  "updated_at",
  "linked_by",
].join(", ");
export const TAKEOFF_DPGF_REVIEW_DECISIONS_SELECT = [
  "id",
  "tenant_id",
  "version_id",
  "takeoff_job_id",
  "estimate_item_id",
  "review_reference",
  "line_label",
  "line_position",
  "source_file_name",
  "source_page",
  "carried_over_from_version_id",
  "carried_over_at",
  "decision",
  "reason",
  "decided_at",
  "updated_at",
  "decided_by",
].join(", ");
export async function getEstimateVersionNumbersById(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionIds: string[];
}) {
  const uniqueVersionIds = [...new Set(input.versionIds)];
  if (uniqueVersionIds.length === 0) {
    return new Map<string, number>();
  }

  const { data, error } = await input.supabase
    .from("estimate_versions" as never)
    .select("id, version_number" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .in("id" as never, uniqueVersionIds as never);

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(
        error,
        "Impossible de charger les numéros de version des décisions DPGF."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  return new Map(
    ((data ?? []) as Array<{ id: string; version_number: number }>).map((row) => [
      row.id,
      row.version_number,
    ])
  );
}

export async function listTakeoffDpgfEstimateItems(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
}) {
  // One access check per statement, not one per item: supabase/migrations/20261024130000_read_estimate_version_items.sql.
  // PostgREST orders a function's rows by the selected columns only: created_at is selected for the order.
  const { data, error } = await readAllRows(() => input.supabase
    .rpc("read_estimate_version_items" as never,
      { p_tenant_id: input.tenantId, p_version_id: input.versionId } as never, { count: "exact", get: true })
    .select(`${ESTIMATE_DPGF_COMPARE_SELECT}, created_at` as never)
    .eq("item_type" as never, "line" as never)
    .order("position" as never, { ascending: true })
    .order("created_at" as never, { ascending: true })
    .order("id" as never, { ascending: true }));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les lignes DPGF de la version."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  return (data ?? []).map((row) => normalizeTakeoffDpgfEstimateItemRow(row));
}

export async function hasTakeoffDpgfTargetLines(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_items" as never)
    .select("id" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("version_id" as never, input.versionId as never)
    .eq("item_type" as never, "line" as never)
    .eq("source_provider" as never, "dpgf" as never)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(
        error,
        "Impossible de vérifier la présence de lignes DPGF avant application."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  return data !== null;
}

export async function listTakeoffDpgfManualLinks(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
  jobId: string;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("takeoff_dpgf_links" as never)
    .select(TAKEOFF_DPGF_LINKS_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("version_id" as never, input.versionId as never)
    .eq("takeoff_job_id" as never, input.jobId as never)
    .order("created_at" as never, { ascending: true })
    .order("id" as never, { ascending: true }));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les liens manuels DPGF."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  return normalizeTakeoffDpgfManualLinkRows((data ?? []) as unknown[]);
}

export async function listTakeoffDpgfReviewDecisions(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
  jobId: string;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("takeoff_dpgf_review_decisions" as never)
    .select(TAKEOFF_DPGF_REVIEW_DECISIONS_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("version_id" as never, input.versionId as never)
    .eq("takeoff_job_id" as never, input.jobId as never)
    .order("updated_at" as never, { ascending: false })
    .order("id" as never, { ascending: false }));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les décisions DPGF."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  const rows = (data ?? []) as unknown[];
  const carriedOverVersionNumberById = await getEstimateVersionNumbersById({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionIds: getCarriedOverVersionIds(rows),
  });

  return buildTakeoffDpgfReviewDecisionRecords({
    rows,
    carriedOverVersionNumberById,
  });
}

export async function resolveDpgfUnitByRowIndex(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  projectId: string;
  sourceFileName: string | null;
}) {
  let importQuery = input.supabase
    .from("dpgf_imports" as never)
    .select("id" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("project_id" as never, input.projectId as never);

  if (input.sourceFileName) {
    importQuery = importQuery.eq("filename" as never, input.sourceFileName as never);
  }

  const { data: importData, error: importError } = await importQuery
    .order("created_at" as never, { ascending: false })
    .limit(1)
    .maybeSingle();

  if (importError) {
    throw toTakeoffError(
      mapSupabaseError(importError, "Impossible de résoudre l'import DPGF source."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  const importRow = (importData ?? null) as { id: string } | null;

  if (!importRow || typeof importRow.id !== "string") {
    return new Map<number, string | null>();
  }

  const { data, error } = await readAllRows(() => input.supabase
    .from("dpgf_rows_mapped" as never)
    .select("id, payload" as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("import_id" as never, importRow.id as never)
    .order("created_at" as never, { ascending: true })
    .order("id" as never, { ascending: true }));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les lignes DPGF mappées."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  const rows = normalizeTakeoffDpgfMappedRows((data ?? []) as unknown[]);
  return buildDpgfUnitByRowIndex(rows);
}
