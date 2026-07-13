import type {
  TakeoffJobOperatorState,
  TakeoffProcessingStrategy,
  TakeoffProviderBatchState,
} from "@/lib/takeoff/types";
import {
  getTakeoffVisibleJobStatusLabel,
  TAKEOFF_VISIBLE_JOB_STATUSES,
} from "@/lib/takeoff/visible-status";

export const TAKEOFF_MAX_LIST_OFFSET = 10_000;
export const TAKEOFF_LIST_REFRESH_INTERVAL_MS = 20_000;
export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export const STATUS_CSS_MAP: Record<string, string> = {
  queued: "status-draft",
  pending: "status-draft",
  provider_pending: "status-sent",
  processing: "status-sent",
  completed: "status-confirmed",
  review_required: "status-warning",
  action_required: "status-canceled",
  failed: "status-canceled",
  canceled: "status-canceled",
  applied: "status-accepted",
};

export const STATUS_LABEL_MAP: Record<string, string> = {
  pending: "En attente",
  processing: "En cours",
  completed: "Terminé",
  failed: "Échoué",
  canceled: "Annulé",
  applied: "Appliqué",
};

export const STATUS_FILTER_OPTIONS: Array<{
  value: "all" | string;
  label: string;
}> = [
  { value: "all", label: "Tous les statuts" },
  { value: "pending", label: "En attente" },
  { value: "processing", label: "En cours" },
  { value: "completed", label: "Terminé" },
  { value: "failed", label: "Échoué" },
  { value: "canceled", label: "Annulé" },
  { value: "applied", label: "Appliqué" },
];

export const LEVEL_FILTER_OPTIONS: Array<{
  value: "all" | string;
  label: string;
}> = [
  { value: "all", label: "Tous niveaux" },
  { value: "A", label: "Niveau A" },
  { value: "B", label: "Niveau B" },
  { value: "C", label: "Niveau C" },
];

export const PERIOD_FILTER_OPTIONS: Array<{
  value: "all" | string;
  label: string;
}> = [
  { value: "all", label: "Toutes périodes" },
  { value: "7d", label: "7 jours" },
  { value: "30d", label: "30 jours" },
  { value: "90d", label: "90 jours" },
];

export function getStatusLabel(status: string) {
  return STATUS_LABEL_MAP[status] ?? status;
}

export function getStatusCss(status: string) {
  return STATUS_CSS_MAP[status] ?? "status-draft";
}

export function formatTimestamp(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("fr-FR");
}

export function formatDurationMs(ms: number | null) {
  if (ms === null || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatCostCents(cents: number | null) {
  if (cents === null || !Number.isFinite(cents)) return "-";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

export function formatCount(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "-";
  return new Intl.NumberFormat("fr-FR").format(value);
}

export function resolveErrorTitle(status: number | null) {
  if (status === 403) return "Accès refusé";
  if (status === 404) return "Ressource introuvable";
  if (status === 401) return "Session expirée";
  return "Erreur de chargement";
}

type TakeoffJobListRefreshPayload = {
  counters?: { processing?: number };
  jobs?: Array<{ status: string }>;
};

export function resolveTakeoffJobsRefreshInterval(
  latestData?: TakeoffJobListRefreshPayload
) {
  if (!latestData) return 0;

  const hasProcessingJobs = (latestData.counters?.processing ?? 0) > 0;
  const hasVisiblePendingJobs =
    latestData.jobs?.some((job) => job.status === "pending") ?? false;

  return hasProcessingJobs || hasVisiblePendingJobs
    ? TAKEOFF_LIST_REFRESH_INTERVAL_MS
    : 0;
}

export function resolveTakeoffMaxNavigablePagesByOffset(pageSize: number) {
  const normalizedPageSize =
    Number.isFinite(pageSize) && pageSize > 0 ? Math.trunc(pageSize) : 1;

  return Math.floor(TAKEOFF_MAX_LIST_OFFSET / normalizedPageSize) + 1;
}

export function CounterCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <article className="rounded-xl border border-[var(--slate-200)] bg-white p-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
        {label}
      </p>
      <p className="mt-1 text-xl font-black text-[var(--slate-800)]">
        {formatCount(value)}
      </p>
    </article>
  );
}

/* --- Business-language labels (V3-007) --- */

export const BUSINESS_LEVEL_LABEL_MAP: Record<string, string> = {
  A: "Rapide",
  B: "Standard",
  C: "Détaillé",
};

export const BUSINESS_LEVEL_FILTER_OPTIONS: Array<{
  value: "all" | string;
  label: string;
}> = [
  { value: "all", label: "Tous niveaux" },
  { value: "A", label: "Rapide" },
  { value: "B", label: "Standard" },
  { value: "C", label: "Détaillé" },
];

export const BUSINESS_STATUS_LABEL_MAP: Record<string, string> = {
  queued: getTakeoffVisibleJobStatusLabel("queued"),
  processing: getTakeoffVisibleJobStatusLabel("processing"),
  provider_pending: getTakeoffVisibleJobStatusLabel("provider_pending"),
  review_required: getTakeoffVisibleJobStatusLabel("review_required"),
  action_required: getTakeoffVisibleJobStatusLabel("action_required"),
  completed: getTakeoffVisibleJobStatusLabel("completed"),
};

export const BUSINESS_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "Tous les statuts" },
  ...TAKEOFF_VISIBLE_JOB_STATUSES.map((status) => ({
    value: status,
    label: getTakeoffVisibleJobStatusLabel(status),
  })),
] as const;

export function getBusinessLevelLabel(level: string): string {
  return BUSINESS_LEVEL_LABEL_MAP[level] ?? level;
}

export function getBusinessStatusLabel(status: string): string {
  return BUSINESS_STATUS_LABEL_MAP[status] ?? status;
}

const PROCESSING_STRATEGY_LABEL_MAP: Record<TakeoffProcessingStrategy, string> = {
  sync: "Immédiate",
  batch: "Différée",
};

const PROVIDER_BATCH_STATE_LABEL_MAP: Record<TakeoffProviderBatchState, string> = {
  submitted: "Analyse envoyée",
  pending: "Analyse en attente",
  running: "Analyse en cours",
  succeeded: "Analyse terminée",
  failed: "Échec de l’analyse",
  cancelled: "Analyse annulée",
  expired: "Analyse expirée",
  unknown: "État de l’analyse inconnu",
};

export function getProcessingStrategyLabel(
  strategy: TakeoffProcessingStrategy | null | undefined
): string {
  if (!strategy) {
    return "Mode d’analyse inconnu";
  }

  return PROCESSING_STRATEGY_LABEL_MAP[strategy] ?? strategy;
}

export function getProviderBatchStateLabel(input: {
  strategy: TakeoffProcessingStrategy | null | undefined;
  state: TakeoffProviderBatchState | null | undefined;
}): string {
  if (input.strategy === "sync") {
    return "Traitement immédiat";
  }

  if (!input.state) {
    return "Non lancé";
  }

  return PROVIDER_BATCH_STATE_LABEL_MAP[input.state] ?? input.state;
}

export function getProviderBatchStateBadgeVariant(
  state: TakeoffProviderBatchState | null | undefined
): "neutral" | "info" | "success" | "warning" | "error" {
  if (state === "succeeded") return "success";
  if (state === "failed" || state === "cancelled" || state === "expired") {
    return "error";
  }
  if (state === "unknown") return "warning";
  if (state === "submitted" || state === "pending" || state === "running") {
    return "info";
  }
  return "neutral";
}

export function getOperatorStateBadgeVariant(
  state: TakeoffJobOperatorState | null | undefined
): "neutral" | "info" | "success" | "warning" | "error" {
  if (state === "provider_failed") return "error";
  if (state === "orphan_to_reconcile") return "warning";
  if (state === "submitted_to_provider" || state === "awaiting_provider_result") {
    return "info";
  }
  return "neutral";
}

export function getConfidenceLabel(confidence: number | null): string {
  if (confidence === null) return "Inconnue";
  if (confidence >= 0.8) return "Élevée";
  if (confidence >= 0.5) return "Moyenne";
  return "Faible";
}

export function getConfidenceBadgeVariant(
  label: string
): "success" | "warning" | "error" | "neutral" {
  if (label === "Élevée") return "success";
  if (label === "Moyenne") return "warning";
  if (label === "Faible") return "error";
  return "neutral";
}

export function isCoverageLow(percent: number | null): boolean {
  return percent !== null && percent < 50;
}

export function JobsTableSkeleton() {
  return (
    <section className="dashboard-card mt-4 p-6">
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="h-4 animate-pulse rounded bg-[var(--slate-200)]"
            style={{ width: `${65 + (index % 3) * 10}%` }}
          />
        ))}
      </div>
    </section>
  );
}
