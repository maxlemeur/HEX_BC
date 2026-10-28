import type { Database } from "@/types/database";
import type { AffaireIntakeWorkspaceMissingPiece } from "@/lib/affaires/intake";
import { isPriceStale } from "@/lib/catalogue/stale-prices";
import { computeEstimateQualityFlagsByItemId } from "@/lib/estimate-quality";
import { detectEstimateOutliers } from "@/lib/estimates/outlier-detection";
import {
  buildTakeoffRiskCandidates,
  normalizeRiskAlertRow,
  type TakeoffRiskCandidate,
} from "@/lib/takeoff/risk-radar";
import type {
  TakeoffDpgfComparisonResponse,
  TakeoffRiskAlert,
  UpdateTakeoffRiskAlertStatusInput,
} from "@/lib/takeoff/types";

export type EstimateRiskItemRow = {
  id: string;
  parent_id: string | null;
  item_type: string;
  pricing_status: string | null;
  title: string;
  description: string | null;
  quantity: number | null;
  category_id: string | null;
  selected_supplier_price_id: string | null;
  unit_price_ht_cents: number | null;
  tax_rate_bp: number | null;
  h_mo: number | null;
  labor_role_id: string | null;
  h_mo_atelier: number | null;
  labor_role_atelier_id: string | null;
  k_mo_atelier: number | null;
  h_mo_chantier: number | null;
  labor_role_chantier_id: string | null;
  k_mo_chantier: number | null;
};

export type EstimateRiskVersionContext = {
  id: string;
  tenant_id: string;
  project_id: string;
  status: string;
  updated_at: string;
  content_revision: number;
  calc_engine_version: number | null;
  calc_snapshot_content_revision: number | null;
  calc_snapshot_context: Database["public"]["Tables"]["estimate_versions"]["Row"]["calc_snapshot_context"];
  discount_amount_cents: number | null;
  project_user_id: string;
  margin_bp: number | null;
  margin_multiplier: number | null;
  discount_bp: number | null;
  total_ht_cents: number | null;
  tax_rate_bp: number | null;
  project_name: string;
  client_name: string | null;
};

export type ExistingRiskAlertRecord = TakeoffRiskAlert & {
  is_active: boolean;
  scope_ref: string;
};

function hasRiskLaborSplitPayload(item: EstimateRiskItemRow) {
  return (
    item.h_mo_atelier !== null ||
    item.labor_role_atelier_id !== null ||
    item.h_mo_chantier !== null ||
    item.labor_role_chantier_id !== null ||
    ((item.k_mo_atelier ?? 1) !== 1) ||
    ((item.k_mo_chantier ?? 1) !== 1)
  );
}

export function buildDismissedOutlierFlagsByItemId(
  rows: Array<{ item_id: string; flag_key: "price_outlier" | "quantity_outlier" }>
) {
  const result: Record<string, Array<"price_outlier" | "quantity_outlier">> = {};

  for (const row of rows) {
    const current = result[row.item_id] ?? [];
    if (current.includes(row.flag_key)) {
      continue;
    }

    result[row.item_id] = [...current, row.flag_key];
  }

  return result;
}

export function buildRiskAlertIdentityKey(input: {
  scope_type: string;
  scope_ref: string;
  cause_code: string;
}) {
  return `${input.scope_type}:${input.scope_ref}:${input.cause_code}`;
}

/** Rows arrive newest first; keep the first persisted alert for each identity. */
export function normalizeExistingRiskAlertRecords(rows: Record<string, unknown>[]) {
  const records = rows
    .map((row) => {
      const normalized = normalizeRiskAlertRow(row);
      if (!normalized || typeof row.scope_ref !== "string") {
        return null;
      }

      return {
        ...normalized,
        is_active: row.is_active === true,
        scope_ref: row.scope_ref,
      } satisfies ExistingRiskAlertRecord;
    })
    .filter((row): row is ExistingRiskAlertRecord => row !== null);

  const recordsByKey = new Map<string, ExistingRiskAlertRecord>();
  for (const record of records) {
    const key = buildRiskAlertIdentityKey({
      scope_type: record.scope_type,
      scope_ref: record.scope_ref,
      cause_code: record.cause_code,
    });
    if (!recordsByKey.has(key)) {
      recordsByKey.set(key, record);
    }
  }

  return Array.from(recordsByKey.values());
}

export function getRiskSupplierPriceIds(items: EstimateRiskItemRow[]) {
  return Array.from(new Set(items
    .filter((item) => item.item_type === "line")
    .map((item) => item.selected_supplier_price_id)
    .filter((priceId): priceId is string => typeof priceId === "string" && priceId.length > 0)));
}

export type RiskSupplierPriceRow = {
  id: string;
  updated_at: string | null;
  created_at: string | null;
};

export function buildStaleSupplierPriceItemIds(input: {
  items: EstimateRiskItemRow[];
  prices: RiskSupplierPriceRow[];
  stalePriceDays: number;
  now: Date;
}) {
  const stalePriceIds = new Set(input.prices
    .filter((price) => isPriceStale({ updatedAt: price.updated_at, createdAt: price.created_at }, input.stalePriceDays, input.now))
    .map((price) => price.id));
  return new Set(input.items
    .filter((item) => item.item_type === "line")
    .filter((item) => item.selected_supplier_price_id ? stalePriceIds.has(item.selected_supplier_price_id) : false)
    .map((item) => item.id));
}

export type RiskMarginRule = {
  scope_type: "global" | "category" | "client";
  scope_id: string | null;
  threshold_value: number;
};

export function resolveApplicableMinMarginThresholdBp(input: {
  rules: RiskMarginRule[];
  projectId: string;
  categoryIds: Set<string>;
}) {
  const thresholds = input.rules
    .filter((rule) => {
      if (rule.scope_type === "global") {
        return true;
      }

      if (rule.scope_type === "category") {
        return typeof rule.scope_id === "string" && input.categoryIds.has(rule.scope_id);
      }

      if (rule.scope_type === "client") {
        return typeof rule.scope_id === "string" && rule.scope_id === input.projectId;
      }

      return false;
    })
    .map((rule) => rule.threshold_value)
    .filter((value) => Number.isFinite(value));

  if (thresholds.length === 0) {
    return null;
  }

  return Math.max(...thresholds);
}

export function prepareTakeoffRiskCandidates(input: {
  comparisonRows: TakeoffDpgfComparisonResponse["rows"];
  estimateItems: EstimateRiskItemRow[];
  versionContext: EstimateRiskVersionContext;
  projectId: string;
  dismissedOutlierFlagsByItemId: Record<string, Array<"price_outlier" | "quantity_outlier">>;
  staleSupplierPriceItemIds: Set<string>;
  applicableMarginThresholdBp: number | null;
  hasMinMarginViolation: boolean;
  missingPieces: AffaireIntakeWorkspaceMissingPiece[];
}) {
  const hasAtLeastOneSplitLine = input.estimateItems.some(
    (item) => item.item_type === "line" && hasRiskLaborSplitPayload(item)
  );
  const outlierFlagsByItemId = detectEstimateOutliers({
    items: input.estimateItems as never,
  });
  const qualityFlagsByItemId = computeEstimateQualityFlagsByItemId(
    input.estimateItems as never,
    {
      outlierFlagsByItemId,
      dismissedOutlierFlagsByItemId: input.dismissedOutlierFlagsByItemId,
      staleSupplierPriceItemIds: input.staleSupplierPriceItemIds,
      isLaborSplitEnabled: hasAtLeastOneSplitLine,
    }
  );
  const marginThresholdBp =
    input.applicableMarginThresholdBp ?? (input.versionContext.margin_bp !== null ? 1000 : null);
  const shouldRaiseMarginAlert =
    input.hasMinMarginViolation ||
    (input.applicableMarginThresholdBp === null &&
      input.versionContext.margin_bp !== null &&
      input.versionContext.margin_bp < 1000);
  const { candidates, lotLabelById } = buildTakeoffRiskCandidates({
    comparisonRows: input.comparisonRows,
    estimateItems: input.estimateItems,
    projectId: input.projectId,
    projectLabel: input.versionContext.project_name,
    qualityFlagsByItemId,
    versionTaxRateBp: input.versionContext.tax_rate_bp,
    marginThresholdBp: shouldRaiseMarginAlert ? marginThresholdBp : input.applicableMarginThresholdBp,
    versionMarginBp: input.versionContext.margin_bp,
    missingPieces: input.missingPieces,
  });
  const filteredCandidates = shouldRaiseMarginAlert
    ? candidates
    : candidates.filter((candidate) => candidate.cause_code !== "insufficient_margin");
  return { candidates: filteredCandidates, lotLabelById };
}

export function buildTakeoffRiskRadarProjectionPlan(input: {
  tenantId: string;
  projectId: string;
  versionId: string;
  jobId: string;
  candidates: TakeoffRiskCandidate[];
  existingAlerts: ExistingRiskAlertRecord[];
  now: string;
}) {
  const existingByKey = new Map(
    input.existingAlerts.map((alert) => [
      buildRiskAlertIdentityKey({
        scope_type: alert.scope_type,
        scope_ref: alert.scope_ref,
        cause_code: alert.cause_code,
      }),
      alert,
    ])
  );
  const now = input.now;
  const nextKeys = new Set<string>();
  const inserts: Record<string, unknown>[] = [];
  const updates: Array<{ id: string; payload: Record<string, unknown> }> = [];

  for (const candidate of input.candidates) {
    const key = buildRiskAlertIdentityKey({
      scope_type: candidate.scope_type,
      scope_ref: candidate.scope_ref,
      cause_code: candidate.cause_code,
    });
    nextKeys.add(key);

    const existing = existingByKey.get(key) ?? null;
    const basePayload = {
      tenant_id: input.tenantId,
      project_id: input.projectId,
      version_id: input.versionId,
      takeoff_job_id: input.jobId,
      scope_type: candidate.scope_type,
      scope_ref: candidate.scope_ref,
      scope_id: candidate.scope_id,
      scope_label: candidate.scope_label,
      cause_code: candidate.cause_code,
      severity: candidate.severity,
      risk_score: candidate.risk_score,
      margin_bucket: candidate.margin_bucket,
      line_id: candidate.line_id,
      lot_id: candidate.lot_id,
      reason_labels: candidate.reason_labels,
      provenance: candidate.provenance,
      metadata: candidate.metadata,
      is_active: true,
      last_detected_at: now,
      updated_at: now,
    } satisfies Record<string, unknown>;

    if (existing) {
      updates.push({
        id: existing.alert_id,
        payload: {
          ...basePayload,
          status: existing.status,
          review_note: existing.review_note,
          reviewed_at: existing.reviewed_at,
          reviewed_by: existing.reviewed_by,
        },
      });
      continue;
    }

    inserts.push({
      ...basePayload,
      status: "to_process",
      review_note: null,
      reviewed_at: null,
      reviewed_by: null,
      first_detected_at: now,
    });
  }

  const staleAlertIds = input.existingAlerts
    .filter((alert) => {
      if (!alert.is_active) {
        return false;
      }
      const key = buildRiskAlertIdentityKey({
        scope_type: alert.scope_type,
        scope_ref: alert.scope_ref,
        cause_code: alert.cause_code,
      });
      return !nextKeys.has(key);
    })
    .map((alert) => alert.alert_id);
  return {
    inserts,
    updates,
    staleAlertIds,
    stalePayload: { is_active: false, last_detected_at: now, updated_at: now },
  };
}

export type TakeoffRiskRadarProjectionPlan = ReturnType<typeof buildTakeoffRiskRadarProjectionPlan>;

/** The operation validates the status/note contract before building this write. */
export function buildTakeoffRiskAlertStatusUpdate(input: {
  payload: UpdateTakeoffRiskAlertStatusInput;
  userId: string;
  now: string;
}) {
  const { payload, userId, now } = input;
  const normalizedReviewNote = payload.status === "to_process"
    ? null
    : payload.review_note?.trim().length ? payload.review_note.trim() : null;
  return {
    status: payload.status,
    review_note: normalizedReviewNote,
    reviewed_at: payload.status === "to_process" ? null : now,
    reviewed_by: payload.status === "to_process" ? null : userId,
    updated_at: now,
  };
}
