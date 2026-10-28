import "server-only";

import { readAllRowsInChunks } from "@/lib/supabase/read-all";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import {
  normalizeEvidenceRow,
  type SupplierPriceEvidenceRow,
  type TakeoffLineEvidenceSyncPlan,
} from "@/lib/takeoff/evidence-preparation";

type EvidenceSelectResult = {
  count?: number | null;
  data: unknown[] | null;
  error: unknown | null;
};

type EvidenceMutationResult = {
  error: unknown | null;
};

type EvidenceSupabaseSelectBuilder = PromiseLike<EvidenceSelectResult> & {
  eq: (column: string, value: unknown) => EvidenceSupabaseSelectBuilder;
  in: (column: string, values: unknown[]) => EvidenceSupabaseSelectBuilder;
  is: (column: string, value: unknown) => EvidenceSupabaseSelectBuilder;
  order: (
    column: string,
    options?: { ascending?: boolean }
  ) => EvidenceSupabaseSelectBuilder;
  range: (from: number, to: number) => EvidenceSupabaseSelectBuilder;
};

type EvidenceSupabaseUpdateBuilder = {
  eq: (column: string, value: unknown) => EvidenceSupabaseUpdateBuilder;
  in: (column: string, values: unknown[]) => Promise<EvidenceMutationResult>;
};

type EvidenceSupabaseTable = {
  select: (columns: string, options?: { count: "exact" }) => EvidenceSupabaseSelectBuilder;
  update?: (payload: Record<string, unknown>) => EvidenceSupabaseUpdateBuilder;
  insert?: (payload: Record<string, unknown>[]) => Promise<EvidenceMutationResult>;
};

export type EvidenceSupabaseClient = {
  from: (table: string) => EvidenceSupabaseTable;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export async function listSupplierPriceEvidenceRows(input: {
  supabase: EvidenceSupabaseClient;
  tenantId: string;
  supplierPriceIds: string[];
}): Promise<Map<string, SupplierPriceEvidenceRow>> {
  const uniqueIds = [...new Set(input.supplierPriceIds)];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const { data, error } = await readAllRowsInChunks(uniqueIds, (pageIds) => input.supabase
    .from("supplier_pricebook")
    .select("id, supplier_sku, unit, unit_price_cents, currency, valid_from, valid_to, notes, supplier_catalog_items!supplier_pricebook_supplier_catalog_item_id_fkey(supplier_sku)", { count: "exact" })
    .eq("tenant_id", input.tenantId)
    .in("id", pageIds));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error as never, "Impossible de charger les sources de prix."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  const rows = Array.isArray(data) ? data : [];
  const normalizedRows = rows
    .filter((row): row is Record<string, unknown> => isRecord(row))
    .map((row) => {
      const joinedValue = row.supplier_catalog_items;
      const joinedItem = Array.isArray(joinedValue)
        ? joinedValue.find((value) => isRecord(value)) ?? null
        : isRecord(joinedValue)
          ? joinedValue
          : null;

      return {
        id: String(row.id),
        supplier_sku: asNullableString(joinedItem?.supplier_sku ?? row.supplier_sku),
        unit: String(row.unit ?? ""),
        unit_price_cents: Number(row.unit_price_cents ?? 0),
        currency: String(row.currency ?? "EUR"),
        valid_from: String(row.valid_from ?? ""),
        valid_to: asNullableString(row.valid_to),
        notes: asNullableString(row.notes),
      };
    });

  return new Map(normalizedRows.map((row) => [row.id, row] as const));
}

export async function listActiveTakeoffLineEvidenceRows(input: {
  supabase: EvidenceSupabaseClient;
  tenantId: string;
  versionId: string;
  jobId: string;
  lineIds: string[];
}) {
  const lineIds = [...new Set(input.lineIds)];
  if (lineIds.length === 0) {
    return [];
  }

  const { data, error } = await readAllRowsInChunks(lineIds, (pageIds) => input.supabase
    .from("estimate_line_evidences")
    .select(
      "id, created_at, tenant_id, project_id, version_id, takeoff_job_id, estimate_item_id, fingerprint, evidence_type, evidence_kind, label, source_label, source_file_name, source_page, confidence_score, note, source_record_table, source_record_id, payload, author_user_id, invalidated_at, invalidated_by, invalidation_reason, supersedes_evidence_id",
      { count: "exact" }
    )
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .eq("takeoff_job_id", input.jobId)
    .in("estimate_item_id", pageIds)
    .is("invalidated_at", null));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error as never, "Impossible de charger les preuves existantes."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  return (Array.isArray(data) ? data : []).map((row) => normalizeEvidenceRow(row));
}

export async function applyTakeoffLineEvidenceSyncPlan(input: {
  supabase: EvidenceSupabaseClient;
  tenantId: string;
  jobId: string;
  plan: TakeoffLineEvidenceSyncPlan;
}) {
  const { invalidateIds, inserts, invalidation } = input.plan;
  const evidenceTable = input.supabase.from("estimate_line_evidences");

  if (invalidateIds.length > 0 && evidenceTable.update) {
    const updateResult = await evidenceTable
      .update(invalidation)
      .eq("tenant_id", input.tenantId)
      .in("id", invalidateIds);

    if (updateResult.error) {
      throw toTakeoffError(
        mapSupabaseError(updateResult.error as never, "Impossible d'invalider les preuves obsoletes."),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
          jobId: input.jobId,
        }
      );
    }
  }

  if (inserts.length > 0 && evidenceTable.insert) {
    const insertResult = await evidenceTable.insert(inserts);

    if (insertResult.error) {
      throw toTakeoffError(
        mapSupabaseError(insertResult.error as never, "Impossible d'enregistrer les preuves synchronisées."),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
          jobId: input.jobId,
        }
      );
    }
  }
}

export async function listTakeoffLineEvidenceRows(input: {
  supabase: EvidenceSupabaseClient;
  tenantId: string;
  versionId: string;
  jobId: string;
  lineIds: string[];
  includeHistory: boolean;
}) {
  const uniqueLineIds = [...new Set(input.lineIds)];
  if (uniqueLineIds.length === 0) {
    return [];
  }

  const { data, error } = await readAllRowsInChunks(uniqueLineIds, (pageIds) => {
    let query = input.supabase
      .from("estimate_line_evidences")
      .select(
        "id, created_at, tenant_id, project_id, version_id, takeoff_job_id, estimate_item_id, fingerprint, evidence_type, evidence_kind, label, source_label, source_file_name, source_page, confidence_score, note, source_record_table, source_record_id, payload, author_user_id, invalidated_at, invalidated_by, invalidation_reason, supersedes_evidence_id",
        { count: "exact" }
      )
      .eq("tenant_id", input.tenantId)
      .eq("version_id", input.versionId)
      .eq("takeoff_job_id", input.jobId)
      .in("estimate_item_id", pageIds);

    if (!input.includeHistory) {
      query = query.is("invalidated_at", null);
    }

    return query.order("created_at", { ascending: false });
  }, { order: [{ column: "created_at", ascending: false }] });

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error as never, "Impossible de charger les preuves persistees."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  return (Array.isArray(data) ? data : []).map((row) => normalizeEvidenceRow(row));
}

export async function listEvidenceAuthorNames(input: {
  supabase: EvidenceSupabaseClient;
  jobId: string;
  authorIds: string[];
}): Promise<Map<string, string>> {
  const authorIds = input.authorIds;
  let authorNameById = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data, error } = await readAllRowsInChunks(authorIds, (pageIds) => input.supabase
      .from("profiles")
      .select("id, full_name", { count: "exact" })
      .in("id", pageIds));

    if (error) {
      throw toTakeoffError(
        mapSupabaseError(error as never, "Impossible de charger les auteurs des preuves."),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
          jobId: input.jobId,
        }
      );
    }

    const normalized = (Array.isArray(data) ? data : [])
      .filter((row): row is Record<string, unknown> => isRecord(row))
      .map((row) => [String(row.id), String(row.full_name ?? "")] as const);

    authorNameById = new Map(normalized);
  }

  return authorNameById;
}
