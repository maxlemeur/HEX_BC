import { mapSupabaseError, unprocessableEntity } from "@/lib/estimates/errors";
import { TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import type {
  TakeoffDpgfComparisonEvidenceKind,
  TakeoffDpgfComparisonEvidenceType,
  TakeoffDpgfComparisonProof,
  TakeoffDpgfComparisonRow,
  TakeoffLineEvidence,
  TakeoffLineEvidencePanelResponse,
  TakeoffLineEvidenceStatus,
} from "@/lib/takeoff/types";

type EvidenceSelectResult = {
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
  ) => Promise<EvidenceSelectResult>;
};

type EvidenceSupabaseUpdateBuilder = {
  eq: (column: string, value: unknown) => EvidenceSupabaseUpdateBuilder;
  in: (column: string, values: unknown[]) => Promise<EvidenceMutationResult>;
};

type EvidenceSupabaseTable = {
  select: (columns: string) => EvidenceSupabaseSelectBuilder;
  update?: (payload: Record<string, unknown>) => EvidenceSupabaseUpdateBuilder;
  insert?: (payload: Record<string, unknown>[]) => Promise<EvidenceMutationResult>;
};

type EvidenceSupabaseClient = {
  from: (table: string) => EvidenceSupabaseTable;
};

type SupplierPriceEvidenceRow = {
  id: string;
  supplier_sku: string | null;
  unit: string;
  unit_price_cents: number;
  currency: string;
  valid_from: string;
  valid_to: string | null;
  notes: string | null;
};

type EvidenceRow = {
  id: string;
  created_at: string;
  tenant_id: string;
  project_id: string;
  version_id: string;
  takeoff_job_id: string;
  estimate_item_id: string;
  fingerprint: string;
  evidence_type: TakeoffDpgfComparisonEvidenceType | "price_source";
  evidence_kind: TakeoffDpgfComparisonEvidenceKind;
  label: string;
  source_label: string;
  source_file_name: string | null;
  source_page: number | null;
  confidence_score: number | null;
  note: string | null;
  source_record_table: string | null;
  source_record_id: string | null;
  payload: Record<string, unknown>;
  author_user_id: string | null;
  invalidated_at: string | null;
  invalidated_by: string | null;
  invalidation_reason: string | null;
  supersedes_evidence_id: string | null;
};

type DesiredEvidenceSpec = Omit<
  EvidenceRow,
  | "id"
  | "tenant_id"
  | "project_id"
  | "version_id"
  | "takeoff_job_id"
  | "estimate_item_id"
  | "invalidated_at"
  | "invalidated_by"
  | "invalidation_reason"
> & {
  replacement_key: string;
};

const ACTIVE_EVIDENCE_INVALIDATION_REASON = "snapshot_replaced";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRequiredString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw unprocessableEntity(
      "Donnees estimate_line_evidences invalides en base.",
      { row, key },
      "VALIDATION_ERROR"
    );
  }

  return value;
}

function asJsonObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizeEvidenceRow(row: unknown): EvidenceRow {
  if (!isRecord(row)) {
    throw unprocessableEntity(
      "Donnees estimate_line_evidences invalides en base.",
      { row },
      "VALIDATION_ERROR"
    );
  }

  const requiredStrings = [
    "id",
    "created_at",
    "tenant_id",
    "project_id",
    "version_id",
    "takeoff_job_id",
    "estimate_item_id",
    "fingerprint",
    "evidence_type",
    "evidence_kind",
    "label",
    "source_label",
  ] as const;

  for (const key of requiredStrings) {
    asRequiredString(row, key);
  }

  return {
    id: asRequiredString(row, "id"),
    created_at: asRequiredString(row, "created_at"),
    tenant_id: asRequiredString(row, "tenant_id"),
    project_id: asRequiredString(row, "project_id"),
    version_id: asRequiredString(row, "version_id"),
    takeoff_job_id: asRequiredString(row, "takeoff_job_id"),
    estimate_item_id: asRequiredString(row, "estimate_item_id"),
    fingerprint: asRequiredString(row, "fingerprint"),
    evidence_type: asRequiredString(row, "evidence_type") as EvidenceRow["evidence_type"],
    evidence_kind: asRequiredString(row, "evidence_kind") as EvidenceRow["evidence_kind"],
    label: asRequiredString(row, "label"),
    source_label: asRequiredString(row, "source_label"),
    source_file_name: asNullableString(row.source_file_name),
    source_page: asNullableNumber(row.source_page),
    confidence_score: asNullableNumber(row.confidence_score),
    note: asNullableString(row.note),
    source_record_table: asNullableString(row.source_record_table),
    source_record_id: asNullableString(row.source_record_id),
    payload: asJsonObject(row.payload),
    author_user_id: asNullableString(row.author_user_id),
    invalidated_at: asNullableString(row.invalidated_at),
    invalidated_by: asNullableString(row.invalidated_by),
    invalidation_reason: asNullableString(row.invalidation_reason),
    supersedes_evidence_id: asNullableString(row.supersedes_evidence_id),
  };
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  if (!isRecord(value)) {
    return JSON.stringify(String(value));
  }

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);

  return `{${entries.join(",")}}`;
}

function buildFingerprint(input: Record<string, unknown>) {
  return stableSerialize(input);
}

function buildReplacementKey(input: Record<string, unknown>) {
  return stableSerialize(input);
}

function buildEvidenceReplacementKey(input: {
  evidence_type: EvidenceRow["evidence_type"];
  estimate_item_id?: string;
  source_record_table?: string | null;
  source_record_id?: string | null;
}) {
  const sourceRecordTable = input.source_record_table ?? null;
  const sourceRecordId = input.source_record_id ?? null;

  return buildReplacementKey({
    type: input.evidence_type,
    source_record_table: sourceRecordTable,
    source_record_id: sourceRecordId,
    estimate_item_id:
      sourceRecordTable === null && sourceRecordId === null
        ? input.estimate_item_id ?? null
        : null,
  });
}

function formatCurrencyCents(value: number, currency: string) {
  const normalizedCurrency = currency.trim().length > 0 ? currency : "EUR";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: normalizedCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function buildDesiredEvidences(input: {
  row: TakeoffDpgfComparisonRow;
  supplierPrice: SupplierPriceEvidenceRow | null;
}): DesiredEvidenceSpec[] {
  const desired: DesiredEvidenceSpec[] = [];

  desired.push({
    created_at: new Date().toISOString(),
    fingerprint: buildFingerprint({
      type: "dpgf",
      kind: "fact",
      line_id: input.row.line_id,
      label: input.row.dpgf.title,
      source_label: input.row.dpgf.source_file_name
        ? `DPGF ${input.row.dpgf.source_file_name}`
        : "DPGF importe",
      source_file_name: input.row.dpgf.source_file_name,
      source_page: input.row.dpgf.source_page,
      note: input.row.dpgf.source_page !== null ? `Ligne source ${input.row.dpgf.source_page}` : null,
      position: input.row.dpgf.position,
    }),
    replacement_key: buildEvidenceReplacementKey({
      evidence_type: "dpgf",
      source_record_table: "estimate_items",
      source_record_id: input.row.line_id,
    }),
    evidence_type: "dpgf",
    evidence_kind: "fact",
    label: input.row.dpgf.title,
    source_label: input.row.dpgf.source_file_name
      ? `DPGF ${input.row.dpgf.source_file_name}`
      : "DPGF importe",
    source_file_name: input.row.dpgf.source_file_name,
    source_page: input.row.dpgf.source_page,
    confidence_score: null,
    note: input.row.dpgf.source_page !== null ? `Ligne source ${input.row.dpgf.source_page}` : null,
    source_record_table: "estimate_items",
    source_record_id: input.row.line_id,
    payload: {
      position: input.row.dpgf.position,
      unit: input.row.dpgf.unit,
      description: input.row.dpgf.description,
    },
    author_user_id: null,
    supersedes_evidence_id: null,
  });

  for (const item of input.row.linked_takeoff_items) {
    desired.push({
      created_at: new Date().toISOString(),
      fingerprint: buildFingerprint({
        type: "takeoff",
        kind: "fact",
        item_id: item.item_id,
        label: item.designation,
        source_label: item.source_file_name
          ? `${item.source_file_name}${item.source_page ? ` p.${item.source_page}` : ""}`
          : item.source_page
            ? `Plan p.${item.source_page}`
            : "Item takeoff",
        source_file_name: item.source_file_name,
        source_page: item.source_page,
        confidence_score: item.confidence,
        note: item.evidence,
      }),
      replacement_key: buildEvidenceReplacementKey({
        evidence_type: "takeoff",
        source_record_table: "takeoff_items",
        source_record_id: item.item_id,
      }),
      evidence_type: "takeoff",
      evidence_kind: "fact",
      label: item.designation,
      source_label: item.source_file_name
        ? `${item.source_file_name}${item.source_page ? ` p.${item.source_page}` : ""}`
        : item.source_page
          ? `Plan p.${item.source_page}`
          : "Item takeoff",
      source_file_name: item.source_file_name,
      source_page: item.source_page,
      confidence_score: item.confidence,
      note: item.evidence,
      source_record_table: "takeoff_items",
      source_record_id: item.item_id,
      payload: {
        quantity: item.quantity,
        unit: item.unit,
        metadata: item.metadata,
      },
      author_user_id: null,
      supersedes_evidence_id: null,
    });

    if (item.source_page !== null || item.source_file_name) {
      desired.push({
        created_at: new Date().toISOString(),
        fingerprint: buildFingerprint({
          type: "plan_zone",
          kind: "fact",
          item_id: item.item_id,
          label: item.source_page !== null ? `Zone / page ${item.source_page}` : "Zone plan",
          source_label: item.source_file_name ?? "Plan source",
          source_file_name: item.source_file_name,
          source_page: item.source_page,
          confidence_score: item.confidence,
          note: item.evidence,
        }),
        replacement_key: buildEvidenceReplacementKey({
          evidence_type: "plan_zone",
          source_record_table: "takeoff_items",
          source_record_id: item.item_id,
        }),
        evidence_type: "plan_zone",
        evidence_kind: "fact",
        label: item.source_page !== null ? `Zone / page ${item.source_page}` : "Zone plan",
        source_label: item.source_file_name ?? "Plan source",
        source_file_name: item.source_file_name,
        source_page: item.source_page,
        confidence_score: item.confidence,
        note: item.evidence,
        source_record_table: "takeoff_items",
        source_record_id: item.item_id,
        payload: {
          item_id: item.item_id,
          quantity: item.quantity,
          unit: item.unit,
        },
        author_user_id: null,
        supersedes_evidence_id: null,
      });
    }
  }

  if (input.row.linked_takeoff_items.length > 1 && input.row.takeoff_quantity !== null) {
    desired.push({
      created_at: new Date().toISOString(),
      fingerprint: buildFingerprint({
        type: "formula",
        kind: "inference",
        line_id: input.row.line_id,
        linked_takeoff_item_ids: input.row.linked_takeoff_items.map((item) => item.item_id).sort(),
        takeoff_quantity: input.row.takeoff_quantity,
        quantity_unit: input.row.quantity_unit,
      }),
      replacement_key: buildEvidenceReplacementKey({
        evidence_type: "formula",
        estimate_item_id: input.row.line_id,
      }),
      evidence_type: "formula",
      evidence_kind: "inference",
      label: `Somme de ${input.row.linked_takeoff_items.length} items takeoff`,
      source_label: "Aggregation manuelle",
      source_file_name: null,
      source_page: null,
      confidence_score: input.row.confidence_score,
      note: "La quantite takeoff agregee provient de plusieurs items relies.",
      source_record_table: null,
      source_record_id: null,
      payload: {
        linked_takeoff_item_ids: input.row.linked_takeoff_items.map((item) => item.item_id),
        takeoff_quantity: input.row.takeoff_quantity,
        quantity_unit: input.row.quantity_unit,
      },
      author_user_id: null,
      supersedes_evidence_id: null,
    });
  }

  if (input.supplierPrice) {
    desired.push({
      created_at: new Date().toISOString(),
      fingerprint: buildFingerprint({
        type: "price_source",
        kind: "fact",
        supplier_price_id: input.supplierPrice.id,
        label: input.supplierPrice.supplier_sku ?? "Prix fournisseur selectionne",
        price_note: formatCurrencyCents(
          input.supplierPrice.unit_price_cents,
          input.supplierPrice.currency
        ),
      }),
      replacement_key: buildEvidenceReplacementKey({
        evidence_type: "price_source",
        source_record_table: "supplier_pricebook",
        source_record_id: input.supplierPrice.id,
      }),
      evidence_type: "price_source",
      evidence_kind: "fact",
      label: input.supplierPrice.supplier_sku ?? "Prix fournisseur selectionne",
      source_label: "Pricebook fournisseur",
      source_file_name: null,
      source_page: null,
      confidence_score: null,
      note: [
        `${formatCurrencyCents(input.supplierPrice.unit_price_cents, input.supplierPrice.currency)} / ${input.supplierPrice.unit}`,
        input.supplierPrice.notes ?? null,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" - "),
      source_record_table: "supplier_pricebook",
      source_record_id: input.supplierPrice.id,
      payload: {
        valid_from: input.supplierPrice.valid_from,
        valid_to: input.supplierPrice.valid_to,
        unit: input.supplierPrice.unit,
        currency: input.supplierPrice.currency,
      },
      author_user_id: null,
      supersedes_evidence_id: null,
    });
  }

  if (input.row.applied_decision?.reason?.trim()) {
    desired.push({
      created_at: input.row.applied_decision.decided_at,
      fingerprint: buildFingerprint({
        type: "comment",
        kind:
          input.row.applied_decision.decision === "manual_fix" ||
          input.row.applied_decision.decision === "out_of_scope"
            ? "hypothesis"
            : "inference",
        decision_id: input.row.applied_decision.id,
        decision: input.row.applied_decision.decision,
        reason: input.row.applied_decision.reason,
        source: input.row.applied_decision.source,
      }),
      replacement_key: buildEvidenceReplacementKey({
        evidence_type: "comment",
        source_record_table: "takeoff_dpgf_review_decisions",
        source_record_id: input.row.applied_decision.id,
      }),
      evidence_type: "comment",
      evidence_kind:
        input.row.applied_decision.decision === "manual_fix" ||
        input.row.applied_decision.decision === "out_of_scope"
          ? "hypothesis"
          : "inference",
      label:
        input.row.applied_decision.decision === "manual_fix"
          ? "Hypothese manuelle"
          : "Arbitrage de revue",
      source_label:
        input.row.applied_decision.source === "carried_over"
          ? "Decision reprise depuis une version precedente"
          : "Decision de revue humaine",
      source_file_name: null,
      source_page: null,
      confidence_score: null,
      note: input.row.applied_decision.reason,
      source_record_table: "takeoff_dpgf_review_decisions",
      source_record_id: input.row.applied_decision.id,
      payload: {
        decision: input.row.applied_decision.decision,
        source: input.row.applied_decision.source,
        carried_over_from_version_id: input.row.applied_decision.carried_over_from_version_id,
        carried_over_from_version_number:
          input.row.applied_decision.carried_over_from_version_number,
      },
      author_user_id: input.row.applied_decision.decided_by,
      supersedes_evidence_id: null,
    });
  }

  return desired;
}

function mapReplacementStatus(input: {
  row: EvidenceRow;
  replacedByEvidenceId: string | null;
}): TakeoffLineEvidenceStatus {
  if (input.row.invalidated_at && input.replacedByEvidenceId) {
    return "replaced";
  }

  if (input.row.invalidated_at) {
    return "invalidated";
  }

  return "active";
}

function toLineEvidenceEntry(input: {
  row: EvidenceRow;
  authorNameById: Map<string, string>;
  replacedByEvidenceId: string | null;
}): TakeoffLineEvidence {
  return {
    evidence_id: input.row.id,
    type: input.row.evidence_type,
    kind: input.row.evidence_kind,
    label: input.row.label,
    source: input.row.source_label,
    source_file_name: input.row.source_file_name,
    source_page: input.row.source_page,
    confidence_score: input.row.confidence_score,
    note: input.row.note,
    created_at: input.row.created_at,
    author_name:
      input.row.author_user_id !== null
        ? (input.authorNameById.get(input.row.author_user_id) ?? null)
        : null,
    status: mapReplacementStatus({
      row: input.row,
      replacedByEvidenceId: input.replacedByEvidenceId,
    }),
    supersedes_evidence_id: input.row.supersedes_evidence_id,
    replaced_by_evidence_id: input.replacedByEvidenceId,
  };
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

  const { data, error } = await input.supabase
    .from("supplier_pricebook")
    .select("id, supplier_sku, unit, unit_price_cents, currency, valid_from, valid_to, notes, supplier_catalog_items!supplier_pricebook_supplier_catalog_item_id_fkey(supplier_sku)")
    .eq("tenant_id", input.tenantId)
    .in("id", uniqueIds);

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

export async function syncTakeoffLineEvidences(input: {
  supabase: EvidenceSupabaseClient;
  tenantId: string;
  userId: string | null;
  projectId: string;
  versionId: string;
  jobId: string;
  rows: TakeoffDpgfComparisonRow[];
  supplierPriceByEstimateItemId?: Map<string, SupplierPriceEvidenceRow>;
}) {
  const lineIds = [...new Set(input.rows.map((row) => row.line_id))];
  if (lineIds.length === 0) {
    return;
  }

  const { data, error } = await input.supabase
    .from("estimate_line_evidences")
    .select(
      "id, created_at, tenant_id, project_id, version_id, takeoff_job_id, estimate_item_id, fingerprint, evidence_type, evidence_kind, label, source_label, source_file_name, source_page, confidence_score, note, source_record_table, source_record_id, payload, author_user_id, invalidated_at, invalidated_by, invalidation_reason, supersedes_evidence_id"
    )
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .eq("takeoff_job_id", input.jobId)
    .in("estimate_item_id", lineIds)
    .is("invalidated_at", null);

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

  const existingRows = (Array.isArray(data) ? data : []).map((row) => normalizeEvidenceRow(row));
  const existingByLineId = new Map<string, EvidenceRow[]>();
  for (const row of existingRows) {
    const rows = existingByLineId.get(row.estimate_item_id) ?? [];
    rows.push(row);
    existingByLineId.set(row.estimate_item_id, rows);
  }

  const now = new Date().toISOString();
  const invalidateIds: string[] = [];
  const inserts: Record<string, unknown>[] = [];

  for (const row of input.rows) {
    const desired = buildDesiredEvidences({
      row,
      supplierPrice: input.supplierPriceByEstimateItemId?.get(row.line_id) ?? null,
    });
    const existingForLine = existingByLineId.get(row.line_id) ?? [];
    const existingByFingerprint = new Map(
      existingForLine.map((entry) => [entry.fingerprint, entry] as const)
    );
    const desiredFingerprints = new Set(desired.map((entry) => entry.fingerprint));
    const removedByReplacementKey = new Map<string, EvidenceRow>();

    for (const existing of existingForLine) {
      if (desiredFingerprints.has(existing.fingerprint)) {
        continue;
      }

      invalidateIds.push(existing.id);
      removedByReplacementKey.set(
        buildEvidenceReplacementKey({
          evidence_type: existing.evidence_type,
          estimate_item_id: existing.estimate_item_id,
          source_record_table: existing.source_record_table,
          source_record_id: existing.source_record_id,
        }),
        existing
      );
    }

    for (const desiredEntry of desired) {
      if (existingByFingerprint.has(desiredEntry.fingerprint)) {
        continue;
      }

      const superseded = removedByReplacementKey.get(desiredEntry.replacement_key) ?? null;
      inserts.push({
        created_at: desiredEntry.created_at,
        tenant_id: input.tenantId,
        project_id: input.projectId,
        version_id: input.versionId,
        takeoff_job_id: input.jobId,
        estimate_item_id: row.line_id,
        fingerprint: desiredEntry.fingerprint,
        evidence_type: desiredEntry.evidence_type,
        evidence_kind: desiredEntry.evidence_kind,
        label: desiredEntry.label,
        source_label: desiredEntry.source_label,
        source_file_name: desiredEntry.source_file_name,
        source_page: desiredEntry.source_page,
        confidence_score: desiredEntry.confidence_score,
        note: desiredEntry.note,
        source_record_table: desiredEntry.source_record_table,
        source_record_id: desiredEntry.source_record_id,
        payload: desiredEntry.payload,
        author_user_id: desiredEntry.author_user_id,
        supersedes_evidence_id: superseded?.id ?? null,
      });
    }
  }

  const evidenceTable = input.supabase.from("estimate_line_evidences");

  if (invalidateIds.length > 0 && evidenceTable.update) {
    const updateResult = await evidenceTable
      .update({
        invalidated_at: now,
        invalidated_by: input.userId,
        invalidation_reason: ACTIVE_EVIDENCE_INVALIDATION_REASON,
      })
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
        mapSupabaseError(insertResult.error as never, "Impossible de persister les preuves synchronisees."),
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

  let query = input.supabase
    .from("estimate_line_evidences")
    .select(
      "id, created_at, tenant_id, project_id, version_id, takeoff_job_id, estimate_item_id, fingerprint, evidence_type, evidence_kind, label, source_label, source_file_name, source_page, confidence_score, note, source_record_table, source_record_id, payload, author_user_id, invalidated_at, invalidated_by, invalidation_reason, supersedes_evidence_id"
    )
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .eq("takeoff_job_id", input.jobId)
    .in("estimate_item_id", uniqueLineIds);

  if (!input.includeHistory) {
    query = query.is("invalidated_at", null);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

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

export async function mapTakeoffLineEvidencePanel(input: {
  supabase: EvidenceSupabaseClient;
  tenantId: string;
  versionId: string;
  jobId: string;
  lineId: string;
}): Promise<TakeoffLineEvidencePanelResponse> {
  const rows = await listTakeoffLineEvidenceRows({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
    jobId: input.jobId,
    lineIds: [input.lineId],
    includeHistory: true,
  });

  const authorIds = rows
    .map((row) => row.author_user_id)
    .filter((authorId): authorId is string => Boolean(authorId));

  let authorNameById = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data, error } = await input.supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", [...new Set(authorIds)]);

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

  const replacedByEvidenceIdBySourceId = new Map<string, string>();
  for (const row of rows) {
    if (row.supersedes_evidence_id) {
      replacedByEvidenceIdBySourceId.set(row.supersedes_evidence_id, row.id);
    }
  }

  const entries = rows.map((row) =>
    toLineEvidenceEntry({
      row,
      authorNameById,
      replacedByEvidenceId: replacedByEvidenceIdBySourceId.get(row.id) ?? null,
    })
  );

  return {
    line_id: input.lineId,
    version_id: input.versionId,
    job_id: input.jobId,
    evidences: entries.filter((entry) => entry.status === "active"),
    history: entries.filter((entry) => entry.status !== "active"),
  };
}

export function mapActiveLineEvidenceRowsToProofs(
  rows: EvidenceRow[]
): TakeoffDpgfComparisonProof[] {
  return rows
    .filter((row) => row.invalidated_at === null)
    .map((row) => ({
      proof_id: row.id,
      type: row.evidence_type,
      kind: row.evidence_kind,
      label: row.label,
      source: row.source_label,
      confidence_score: row.confidence_score,
      note: row.note,
    }));
}
