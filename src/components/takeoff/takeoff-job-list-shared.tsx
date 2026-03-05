export const TAKEOFF_MAX_LIST_OFFSET = 10_000;
export const TAKEOFF_LIST_REFRESH_INTERVAL_MS = 20_000;
export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export const STATUS_CSS_MAP: Record<string, string> = {
  pending: "status-draft",
  processing: "status-sent",
  completed: "status-confirmed",
  failed: "status-canceled",
  canceled: "status-canceled",
  applied: "status-accepted",
};

export const STATUS_LABEL_MAP: Record<string, string> = {
  pending: "En attente",
  processing: "En cours",
  completed: "Termine",
  failed: "Echoue",
  canceled: "Annule",
  applied: "Applique",
};

export const STATUS_FILTER_OPTIONS: Array<{
  value: "all" | string;
  label: string;
}> = [
  { value: "all", label: "Tous les statuts" },
  { value: "pending", label: "En attente" },
  { value: "processing", label: "En cours" },
  { value: "completed", label: "Termine" },
  { value: "failed", label: "Echoue" },
  { value: "canceled", label: "Annule" },
  { value: "applied", label: "Applique" },
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
  { value: "all", label: "Toutes periodes" },
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
  if (status === 403) return "Acces refuse";
  if (status === 404) return "Ressource introuvable";
  if (status === 401) return "Session expiree";
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
