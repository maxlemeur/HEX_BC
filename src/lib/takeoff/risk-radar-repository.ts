import "server-only";

import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import { getStalePriceDaysForTenant } from "@/lib/feature-flags";
import { mapSupabaseError, unprocessableEntity } from "@/lib/estimates/errors";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import type { AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import type { TakeoffRiskAlert } from "@/lib/takeoff/types";
import { normalizeRiskAlertRow } from "@/lib/takeoff/risk-radar";
import {
  buildDismissedOutlierFlagsByItemId,
  buildStaleSupplierPriceItemIds,
  getRiskSupplierPriceIds,
  normalizeExistingRiskAlertRecords,
  resolveApplicableMinMarginThresholdBp,
  type EstimateRiskItemRow,
  type EstimateRiskVersionContext,
  type RiskMarginRule,
  type RiskSupplierPriceRow,
  type TakeoffRiskRadarProjectionPlan,
  type buildTakeoffRiskAlertStatusUpdate,
} from "@/lib/takeoff/risk-radar-preparation";

const ESTIMATE_RISK_ITEMS_SELECT = [
  "id",
  "parent_id",
  "item_type",
  // Lot 2, sous-lot 2.6b (G1) : une ligne v3 non chiffrée ne lève aucun drapeau de qualité (estimate-quality.ts).
  "pricing_status",
  "title",
  "description",
  "quantity",
  "category_id",
  "selected_supplier_price_id",
  "unit_price_ht_cents",
  "tax_rate_bp",
  "h_mo",
  "labor_role_id",
  "h_mo_atelier",
  "labor_role_atelier_id",
  "k_mo_atelier",
  "h_mo_chantier",
  "labor_role_chantier_id",
  "k_mo_chantier",
].join(", ");
const ESTIMATE_RISK_VERSION_SELECT = [
  "id",
  "tenant_id",
  "project_id",
  "status",
  "updated_at",
  "content_revision",
  "calc_engine_version",
  "calc_snapshot_content_revision",
  "calc_snapshot_context",
  "discount_amount_cents",
  "margin_bp",
  "margin_multiplier",
  "discount_bp",
  "total_ht_cents",
  "tax_rate_bp",
  "estimate_projects!inner(id, user_id, name, client_name)",
].join(", ");
const ESTIMATE_RISK_ALERTS_SELECT = [
  "id",
  "created_at",
  "updated_at",
  "tenant_id",
  "project_id",
  "version_id",
  "takeoff_job_id",
  "scope_type",
  "scope_ref",
  "scope_id",
  "scope_label",
  "cause_code",
  "severity",
  "status",
  "risk_score",
  "margin_bucket",
  "line_id",
  "lot_id",
  "reason_labels",
  "provenance",
  "metadata",
  "review_note",
  "reviewed_at",
  "reviewed_by",
  "is_active",
  "first_detected_at",
  "last_detected_at",
].join(", ");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveEmbeddedProjectRecord(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((entry) => isRecord(entry)) ?? null;
  }

  return isRecord(value) ? value : null;
}

export async function listEstimateRiskItems(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
}) {
  // One access check per statement, not one per item: supabase/migrations/20261024130000_read_estimate_version_items.sql.
  // PostgREST orders a function's rows by the selected columns only: position and created_at are selected for the order.
  const { data, error } = await readAllRows(() => input.supabase
    .rpc("read_estimate_version_items" as never,
      { p_tenant_id: input.tenantId, p_version_id: input.versionId } as never, { count: "exact", get: true })
    .select(`${ESTIMATE_RISK_ITEMS_SELECT}, position, created_at` as never)
    .order("position" as never, { ascending: true })
    .order("created_at" as never, { ascending: true })
    .order("id" as never, { ascending: true }));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les items de risque de la version."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  return (data ?? []) as EstimateRiskItemRow[];
}

export async function loadEstimateRiskVersionContext(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
}): Promise<EstimateRiskVersionContext> {
  const { data, error } = await input.supabase
    .from("estimate_versions" as never)
    .select(ESTIMATE_RISK_VERSION_SELECT as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.versionId as never)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger le contexte de risque de la version."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  if (!data || !isRecord(data)) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Version cible introuvable.",
      details: {
        version_id: input.versionId,
      },
      retryable: false,
    });
  }

  const versionRow = data as Record<string, unknown>;
  const embeddedProject = resolveEmbeddedProjectRecord(versionRow.estimate_projects);
  if (!embeddedProject) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Projet de la version introuvable.",
      details: {
        version_id: input.versionId,
      },
      retryable: false,
    });
  }

  return {
    id: typeof versionRow.id === "string" ? versionRow.id : input.versionId,
    tenant_id: typeof versionRow.tenant_id === "string" ? versionRow.tenant_id : "",
    status: typeof versionRow.status === "string" ? versionRow.status : "",
    updated_at: typeof versionRow.updated_at === "string" ? versionRow.updated_at : "",
    content_revision: typeof versionRow.content_revision === "number" ? versionRow.content_revision : 0,
    calc_engine_version: typeof versionRow.calc_engine_version === "number" ? versionRow.calc_engine_version : null,
    calc_snapshot_content_revision: typeof versionRow.calc_snapshot_content_revision === "number" ? versionRow.calc_snapshot_content_revision : null,
    calc_snapshot_context: (versionRow.calc_snapshot_context ?? null) as EstimateRiskVersionContext["calc_snapshot_context"],
    discount_amount_cents: typeof versionRow.discount_amount_cents === "number" ? versionRow.discount_amount_cents : null,
    project_user_id: typeof embeddedProject.user_id === "string" ? embeddedProject.user_id : "",
    project_id:
      typeof versionRow.project_id === "string"
        ? versionRow.project_id
        : (typeof embeddedProject.id === "string" ? embeddedProject.id : ""),
    margin_bp:
      typeof versionRow.margin_bp === "number" ? versionRow.margin_bp : null,
    margin_multiplier:
      typeof versionRow.margin_multiplier === "number"
        ? versionRow.margin_multiplier
        : null,
    discount_bp:
      typeof versionRow.discount_bp === "number" ? versionRow.discount_bp : null,
    total_ht_cents:
      typeof versionRow.total_ht_cents === "number"
        ? versionRow.total_ht_cents
        : null,
    tax_rate_bp:
      typeof versionRow.tax_rate_bp === "number" ? versionRow.tax_rate_bp : null,
    project_name:
      typeof embeddedProject.name === "string" && embeddedProject.name.trim().length > 0
        ? embeddedProject.name
        : "Affaire",
    client_name:
      typeof embeddedProject.client_name === "string" ? embeddedProject.client_name : null,
  };
}

export async function loadDismissedOutlierFlagsByItemId(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("estimate_item_outlier_dismissals" as never)
    .select("item_id, flag_key, id" as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("version_id" as never, input.versionId as never)
    .order("dismissed_at" as never, { ascending: true }));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les outliers dismiss."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  return buildDismissedOutlierFlagsByItemId(
    ((data ?? []) as Array<{ item_id: string; flag_key: "price_outlier" | "quantity_outlier" }>)
      .filter(
        (row) =>
          row.flag_key === "price_outlier" || row.flag_key === "quantity_outlier"
      )
  );
}

export async function loadStaleSupplierPriceItemIds(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  items: EstimateRiskItemRow[];
  now: Date;
}) {
  const stalePriceDays = await getStalePriceDaysForTenant(input.tenantId, {
    supabase: input.supabase as never,
  });
  const selectedSupplierPriceIds = getRiskSupplierPriceIds(input.items);

  if (selectedSupplierPriceIds.length === 0) {
    return new Set<string>();
  }

  const { data, error } = await readAllRowsInChunks(selectedSupplierPriceIds, (pageIds) => input.supabase
    .from("supplier_pricebook" as never)
    .select("id, updated_at, created_at" as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never)
    .in("id" as never, pageIds as never));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les prix fournisseurs sélectionnés."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  return buildStaleSupplierPriceItemIds({
    items: input.items,
    prices: (data ?? []) as RiskSupplierPriceRow[],
    stalePriceDays,
    now: input.now,
  });
}

export async function loadApplicableMinMarginThresholdBp(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  projectId: string;
  categoryIds: Set<string>;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("estimate_rules" as never)
    .select("scope_type, scope_id, threshold_value, id" as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("is_active" as never, true as never)
    .eq("rule_type" as never, "min_margin" as never));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les seuils de marge applicables."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  return resolveApplicableMinMarginThresholdBp({
    rules: (data ?? []) as RiskMarginRule[],
    projectId: input.projectId,
    categoryIds: input.categoryIds,
  });
}

export async function listActiveTakeoffRiskAlerts(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
  jobId: string;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("estimate_risk_alerts" as never)
    .select(ESTIMATE_RISK_ALERTS_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("version_id" as never, input.versionId as never)
    .eq("takeoff_job_id" as never, input.jobId as never)
    .eq("is_active" as never, true as never)
    .order("updated_at" as never, { ascending: false })
    .order("id" as never, { ascending: false }));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les alertes de risque actives."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  return ((data ?? []) as Record<string, unknown>[])
    .map((row) => normalizeRiskAlertRow(row))
    .filter((row): row is TakeoffRiskAlert => row !== null);
}

export async function listExistingRiskAlertRecords(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
  jobId: string;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("estimate_risk_alerts" as never)
    .select(ESTIMATE_RISK_ALERTS_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("version_id" as never, input.versionId as never)
    .eq("takeoff_job_id" as never, input.jobId as never)
    .order("updated_at" as never, { ascending: false })
    .order("id" as never, { ascending: false }));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger la projection existante du radar de risque."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  return normalizeExistingRiskAlertRecords((data ?? []) as Record<string, unknown>[]);
}

export async function applyTakeoffRiskRadarProjectionPlan(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  jobId: string;
  plan: TakeoffRiskRadarProjectionPlan;
}) {
  await Promise.all([
    ...input.plan.updates.map(({ id, payload }) =>
      input.supabase
        .from("estimate_risk_alerts" as never)
        .update(payload as never)
        .eq("tenant_id" as never, input.tenantId as never)
        .eq("id" as never, id as never)
    ),
    input.plan.inserts.length > 0
      ? input.supabase.from("estimate_risk_alerts" as never).insert(input.plan.inserts as never)
      : Promise.resolve({ error: null }),
    input.plan.staleAlertIds.length > 0
      ? input.supabase
          .from("estimate_risk_alerts" as never)
          .update(input.plan.stalePayload as never)
          .eq("tenant_id" as never, input.tenantId as never)
          .in("id" as never, input.plan.staleAlertIds as never)
      : Promise.resolve({ error: null }),
  ]).then((results) => {
    for (const result of results) {
      if (result && "error" in result && result.error) {
        throw toTakeoffError(
          mapSupabaseError(result.error, "Impossible de synchroniser le radar de risque."),
          {
            fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
            retryable: false,
            jobId: input.jobId,
          }
        );
      }
    }
  });
}

export async function assertActiveTakeoffRiskAlertExists(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
  jobId: string;
  alertId: string;
}) {
  const { data: alertRow, error: alertError } = await input.supabase
    .from("estimate_risk_alerts" as never)
    .select(ESTIMATE_RISK_ALERTS_SELECT as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.alertId as never)
    .eq("version_id" as never, input.versionId as never)
    .eq("takeoff_job_id" as never, input.jobId as never)
    .eq("is_active" as never, true as never)
    .maybeSingle();

  if (alertError) {
    throw toTakeoffError(
      mapSupabaseError(alertError, "Impossible de charger l'alerte de risque."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  if (!alertRow) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Alerte de risque introuvable.",
      details: {
        alert_id: input.alertId,
      },
      retryable: false,
      jobId: input.jobId,
    });
  }
}

export async function persistTakeoffRiskAlertStatus(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  jobId: string;
  alertId: string;
  payload: ReturnType<typeof buildTakeoffRiskAlertStatusUpdate>;
}) {
  const { data, error } = await input.supabase
    .from("estimate_risk_alerts" as never)
    .update(input.payload as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.alertId as never)
    .select(ESTIMATE_RISK_ALERTS_SELECT as never)
    .single();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de mettre à jour l'alerte de risque."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  const alert = normalizeRiskAlertRow((data ?? null) as Record<string, unknown>);
  if (!alert) {
    throw unprocessableEntity(
      "Alerte de risque invalide en base après mise à jour.",
      {
        alert_id: input.alertId,
      },
      "VALIDATION_ERROR"
    );
  }

  return alert;
}
