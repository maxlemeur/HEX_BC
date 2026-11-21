import type { EstimateAuditLogRow, AuthenticatedContext, VersionAccessRow, EstimateApprovalCorrectionItem, EstimateApprovalChangeField, EstimateApprovalChangesSinceLastCycle, EstimateApprovalReviewCycle } from "@/lib/estimates/approval-types";
import { formatPercentBp, formatEuroCents } from "@/lib/estimates/rule-evaluation";
import { readAllRows } from "@/lib/supabase/read-all";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import type { Json } from "@/types/database";
import { mapSupabaseError } from "@/lib/http/api-response";
import { asFiniteNumber } from "@/lib/value-guards";
import { SUPPORTED_ESTIMATE_CURRENCIES } from "@/lib/money";

const APPROVAL_CHANGE_FIELD_LABELS: Record<string, string> = {
  margin_bp: "Marge",
  discount_bp: "Remise",
  discount_amount_cents: "Remise fixe",
  validite_jours: "Validité",
  rounding_mode: "Mode d'arrondi",
  rounding_step_cents: "Pas d'arrondi",
  tax_rate_bp: "TVA",
  global_coefficient: "Coefficient global",
  margin_mode: "Mode de marge",
  margin_multiplier: "Coefficient de marge",
  title: "Titre du devis",
  date_devis: "Date du devis",
};

function formatChangeFieldValue(input: {
  field: string;
  value: unknown;
  currency?: string;
}) {
  if (input.value === null || input.value === undefined) {
    return "-";
  }

  if (input.field === "discount_amount_cents") {
    const currency = (SUPPORTED_ESTIMATE_CURRENCIES as readonly string[]).includes(input.currency ?? "") ? input.currency! : "EUR";
    return typeof input.value === "number" && Number.isFinite(input.value)
      ? new Intl.NumberFormat("fr-FR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(input.value / 100)
      : String(input.value);
  }

  if (
    input.field === "margin_bp" ||
    input.field === "discount_bp" ||
    input.field === "tax_rate_bp"
  ) {
    return typeof input.value === "number" && Number.isFinite(input.value)
      ? formatPercentBp(input.value)
      : String(input.value);
  }

  if (
    input.field === "rounding_step_cents" ||
    input.field === "total_ht_cents" ||
    input.field === "discount_cents"
  ) {
    return typeof input.value === "number" && Number.isFinite(input.value)
      ? formatEuroCents(input.value)
      : String(input.value);
  }

  if (typeof input.value === "boolean") {
    return input.value ? "Oui" : "Non";
  }

  return String(input.value);
}

function toJsonRecord(value: Json | null): Record<string, unknown> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function collectTouchedLabels(
  rows: EstimateAuditLogRow[],
  limit = 6
) {
  const labels: string[] = [];

  rows.forEach((row) => {
    const afterData = toJsonRecord(row.after_data);
    const beforeData = toJsonRecord(row.before_data);
    const label =
      toStringValue(afterData?.title) ??
      toStringValue(beforeData?.title) ??
      toStringValue(afterData?.scope_label) ??
      toStringValue(beforeData?.scope_label);

    if (!label || labels.includes(label)) {
      return;
    }

    labels.push(label);
  });

  return labels.slice(0, limit);
}

export async function buildChangesSinceLastCycle(input: {
  context: AuthenticatedContext;
  version: VersionAccessRow;
  sourceCycle: EstimateApprovalReviewCycle;
  correctionItems: EstimateApprovalCorrectionItem[];
}) {
  const auditClient = createOptionalServiceRoleClient();
  if (!auditClient) {
    return null;
  }

  const { data, error } = await readAllRows(() => auditClient
    .from("audit_logs")
    .select("created_at, table_name, record_id, action, before_data, after_data, id", { count: "exact" })
    .eq("estimate_version_id", input.version.id)
    .gte("created_at", input.sourceCycle.decidedAt)
    .in("table_name", ["estimate_versions", "estimate_items"])
    .order("created_at", { ascending: true }));

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger le diff depuis le dernier cycle."
    );
  }

  const rows = (data ?? []) as EstimateAuditLogRow[];
  const versionRows = rows.filter((row) => row.table_name === "estimate_versions");
  const itemRows = rows.filter((row) => row.table_name === "estimate_items");
  const lineRows = itemRows.filter((row) => {
    const afterData = toJsonRecord(row.after_data);
    const beforeData = toJsonRecord(row.before_data);
    return (
      toStringValue(afterData?.item_type) === "line" ||
      toStringValue(beforeData?.item_type) === "line"
    );
  });
  const lotRows = itemRows.filter((row) => {
    const afterData = toJsonRecord(row.after_data);
    const beforeData = toJsonRecord(row.before_data);
    return (
      toStringValue(afterData?.item_type) === "section" ||
      toStringValue(beforeData?.item_type) === "section"
    );
  });
  const addedLotsCount = lotRows.filter((row) => row.action === "INSERT").length;
  const removedLotsCount = lotRows.filter((row) => row.action === "DELETE").length;
  const updatedLotsCount = lotRows.filter((row) => row.action === "UPDATE").length;
  const addedLinesCount = lineRows.filter((row) => row.action === "INSERT").length;
  const removedLinesCount = lineRows.filter((row) => row.action === "DELETE").length;
  const updatedLinesCount = lineRows.filter((row) => row.action === "UPDATE").length;
  const earliestVersionBaseline = versionRows
    .map((row) => toJsonRecord(row.before_data))
    .find((entry) => entry !== null);
  const baselineTotalHt =
    asFiniteNumber(earliestVersionBaseline?.total_ht_cents) ??
    input.version.total_ht_cents ??
    null;

  const changeFields = [
    "margin_bp",
    "discount_bp",
    "discount_amount_cents",
    "validite_jours",
    "rounding_mode",
    "rounding_step_cents",
    "tax_rate_bp",
    "global_coefficient",
    "margin_mode",
    "margin_multiplier",
    "title",
    "date_devis",
  ];
  const settingsChanges = changeFields
    .map((field) => {
      const baseline =
        earliestVersionBaseline?.[field] ??
        toJsonRecord(versionRows[0]?.before_data ?? null)?.[field] ??
        null;
      const current = (input.version as Record<string, unknown>)[field] ?? null;
      if (baseline === current) {
        return null;
      }

      return {
        field,
        label: APPROVAL_CHANGE_FIELD_LABELS[field] ?? field,
        before: formatChangeFieldValue({ field, value: baseline, currency: input.version.currency }),
        after: formatChangeFieldValue({ field, value: current, currency: input.version.currency }),
      } satisfies EstimateApprovalChangeField;
    })
    .filter((entry): entry is EstimateApprovalChangeField => entry !== null);

  return {
    sourceCycleId: input.sourceCycle.id,
    sourceCycleNumber: input.sourceCycle.cycleNumber,
    decidedAt: input.sourceCycle.decidedAt,
    treatedItemsCount: input.correctionItems.filter((item) => item.status !== "pending").length,
    toDiscussCount: input.correctionItems.filter((item) => item.status === "to_discuss").length,
    totalHtDeltaCents:
      baselineTotalHt === null || input.version.total_ht_cents === null
        ? null
        : input.version.total_ht_cents - baselineTotalHt,
    addedLotsCount,
    updatedLotsCount,
    removedLotsCount,
    addedLinesCount,
    updatedLinesCount,
    removedLinesCount,
    touchedLabels: collectTouchedLabels(itemRows),
    settingsChanges,
  } satisfies EstimateApprovalChangesSinceLastCycle;
}
