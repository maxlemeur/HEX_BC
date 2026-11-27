import type {
  TakeoffJobOperatorState,
  TakeoffProcessingStrategy,
  TakeoffProviderBatchState,
  TakeoffActivityPlan,
} from "@/lib/takeoff/types";
import { describeTakeoffRequestPages } from "@/lib/takeoff/request-activity";
import {
  getTakeoffVisibleJobStatusLabel,
  TAKEOFF_VISIBLE_JOB_STATUSES,
} from "@/lib/takeoff/visible-status";
import { Card } from "@/components/ui/card";
import { COUNT_FORMAT } from "@/lib/format/fr";

export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

const STATUS_CSS_MAP: Record<string, string> = {
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

const STATUS_LABEL_MAP: Record<string, string> = {
  pending: "En attente",
  processing: "En cours",
  completed: "Terminé",
  failed: "Échoué",
  canceled: "Annulé",
  applied: "Appliqué",
};

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

export function formatCount(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "-";
  return COUNT_FORMAT.format(value);
}

export function formatActivityPlan({ name, pages }: TakeoffActivityPlan) {
  return pages.length ? `${name} · ${describeTakeoffRequestPages(pages)}` : name;
}

export function resolveErrorTitle(status: number | null) {
  if (status === 403) return "Accès refusé";
  if (status === 404) return "Ressource introuvable";
  if (status === 401) return "Session expirée";
  return "Erreur de chargement";
}

export const BUSINESS_LEVEL_FILTER_OPTIONS: Array<{
  value: "all" | string;
  label: string;
}> = [
  { value: "all", label: "Tous niveaux" },
  { value: "A", label: "Rapide" },
  { value: "B", label: "Standard" },
  { value: "C", label: "Détaillé" },
];

export const BUSINESS_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "Tous les statuts" },
  ...TAKEOFF_VISIBLE_JOB_STATUSES.map((status) => ({
    value: status,
    label: getTakeoffVisibleJobStatusLabel(status),
  })),
] as const;

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
): "neutral" | "info" | "success" | "warning" | "danger" {
  if (state === "succeeded") return "success";
  if (state === "failed" || state === "cancelled" || state === "expired") {
    return "danger";
  }
  if (state === "unknown") return "warning";
  if (state === "submitted" || state === "pending" || state === "running") {
    return "info";
  }
  return "neutral";
}

export function getOperatorStateBadgeVariant(
  state: TakeoffJobOperatorState | null | undefined
): "neutral" | "info" | "success" | "warning" | "danger" {
  if (state === "provider_failed") return "danger";
  if (state === "orphan_to_reconcile") return "warning";
  if (state === "submitted_to_provider" || state === "awaiting_provider_result") {
    return "info";
  }
  return "neutral";
}

export function getConfidenceBadgeVariant(
  label: string
): "success" | "warning" | "danger" | "neutral" {
  if (label === "Élevée") return "success";
  if (label === "Moyenne") return "warning";
  if (label === "Faible") return "danger";
  return "neutral";
}

export function isCoverageLow(percent: number | null): boolean {
  return percent !== null && percent < 50;
}

export function JobsTableSkeleton() {
  return (
    <Card className="mt-4 p-6">
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="h-4 animate-pulse rounded bg-border"
            style={{ width: `${65 + (index % 3) * 10}%` }}
          />
        ))}
      </div>
    </Card>
  );
}
