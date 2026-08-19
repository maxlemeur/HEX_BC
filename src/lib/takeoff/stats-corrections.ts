import type { TakeoffCorrectionMetricsEventType, TakeoffMetricsPeriod } from "@/lib/takeoff/metrics-types";

export type TakeoffMetricsAuditLogRow = {
  action: string;
  after_data: unknown;
};

export const PILOT_SATISFACTION_DEFINITION =
  "Proxy calculé sur les dossiers exploitables validés rapidement ou sans retouche explicite.";

export const PILOT_GO_NO_GO_MAX_AVG_COST_CENTS = 1_000;
export const PILOT_GO_NO_GO_MAX_AVG_DURATION_MS = 600_000;
export const PILOT_GO_NO_GO_MAX_CORRECTION_RATE = 40;
export const PILOT_GO_NO_GO_MIN_SATISFACTION_RATE = 60;
export const TAKEOFF_CALIBRATION_MIN_SAMPLE_SIZE = 20;

export function getTrendWindowStart(
  period: TakeoffMetricsPeriod,
  days: number,
  now: Date
): Date {
  const trendStart = new Date(now);
  const offsetDays = period === "7d" ? days - 1 : days;
  trendStart.setDate(trendStart.getDate() - offsetDays);
  return trendStart;
}

export function formatPilotCount(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value);
}

export function formatPilotPercent(value: number): string {
  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value)} %`;
}

export function formatPilotCost(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatPilotDuration(ms: number): string {
  if (ms <= 0) {
    return "0 min";
  }

  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(ms / 60_000)} min`;
}

export function getPilotMinVolumeJobs(period: TakeoffMetricsPeriod): number {
  if (period === "7d") return 3;
  if (period === "30d") return 8;
  return 20;
}

export const CORRECTION_EVENT_LABELS: Record<TakeoffCorrectionMetricsEventType, string> = {
  item_excluded: "Items exclus",
  designation_changed: "Désignations corrigées",
  quantity_changed: "Quantités corrigées",
  unit_changed: "Unités corrigées",
  manual_verification: "Vérifications manuelles",
  dpgf_keep_dpgf: "DPGF conservé",
  dpgf_keep_takeoff: "Métré validé",
  dpgf_manual_fix: "Corrections DPGF manuelles",
  dpgf_out_of_scope: "Lignes hors scope",
};

export const CORRECTION_EVENT_ORDER: TakeoffCorrectionMetricsEventType[] = [
  "item_excluded",
  "designation_changed",
  "quantity_changed",
  "unit_changed",
  "manual_verification",
  "dpgf_keep_dpgf",
  "dpgf_keep_takeoff",
  "dpgf_manual_fix",
  "dpgf_out_of_scope",
];

export const MATERIAL_CORRECTION_EVENTS = new Set<TakeoffCorrectionMetricsEventType>([
  "item_excluded",
  "designation_changed",
  "quantity_changed",
  "unit_changed",
  "dpgf_keep_dpgf",
  "dpgf_manual_fix",
  "dpgf_out_of_scope",
]);

export const QUICK_VALIDATION_EVENTS = new Set<TakeoffCorrectionMetricsEventType>([
  "manual_verification",
  "dpgf_keep_takeoff",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readNestedRecord(
  value: unknown,
  key: string
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

export function readNestedString(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const nested = value[key];
  return typeof nested === "string" ? nested : null;
}

export function readNestedBoolean(value: unknown, key: string): boolean | null {
  if (!isRecord(value)) {
    return null;
  }

  const nested = value[key];
  return typeof nested === "boolean" ? nested : null;
}

export function mapReviewDecisionToCorrectionEventType(
  decision: string
): TakeoffCorrectionMetricsEventType | null {
  switch (decision) {
    case "keep_dpgf":
      return "dpgf_keep_dpgf";
    case "keep_takeoff":
      return "dpgf_keep_takeoff";
    case "manual_fix":
      return "dpgf_manual_fix";
    case "out_of_scope":
      return "dpgf_out_of_scope";
    default:
      return null;
  }
}

export function mapAuditLogToCorrectionEventType(
  auditLog: TakeoffMetricsAuditLogRow
): TakeoffCorrectionMetricsEventType | null {
  if (auditLog.action === "takeoff.dpgf.review_decision") {
    const metadata = readNestedRecord(auditLog.after_data, "metadata");
    const nextDecision = readNestedString(metadata, "next_decision");
    return nextDecision ? mapReviewDecisionToCorrectionEventType(nextDecision) : null;
  }

  if (auditLog.action === "takeoff.item.excluded") {
    return "item_excluded";
  }

  if (auditLog.action !== "takeoff.item.modified") {
    return null;
  }

  const metadata = readNestedRecord(auditLog.after_data, "metadata");
  const field = readNestedString(metadata, "field");

  switch (field) {
    case "designation":
      return "designation_changed";
    case "quantity":
      return "quantity_changed";
    case "unit":
      return "unit_changed";
    case "is_verified": {
      const nextValue = readNestedBoolean(metadata, "next_value");
      return nextValue ? "manual_verification" : null;
    }
    default:
      return null;
  }
}

export function readAuditItemId(auditLog: TakeoffMetricsAuditLogRow): string | null {
  const metadata = readNestedRecord(auditLog.after_data, "metadata");
  return readNestedString(metadata, "item_id");
}

export function isMaterialItemCorrection(auditLog: TakeoffMetricsAuditLogRow) {
  if (auditLog.action === "takeoff.item.excluded") return true;
  if (auditLog.action !== "takeoff.item.modified") return false;
  const metadata = readNestedRecord(auditLog.after_data, "metadata");
  const field = readNestedString(metadata, "field");
  return (
    field === "designation" ||
    field === "quantity" ||
    field === "unit" ||
    field === "is_excluded"
  );
}
