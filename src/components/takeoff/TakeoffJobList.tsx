"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import {
  cancelTakeoffJob,
  isTakeoffApiError,
  listTakeoffJobs,
  retryTakeoffJob,
} from "@/lib/takeoff/client";
import {
  TAKEOFF_JOB_MAX_RETRY_COUNT,
  type TakeoffJobListPeriod,
  type TakeoffJobStatus,
  type TakeoffLevel,
} from "@/lib/takeoff/types";

type TakeoffJobListProps = {
  versionId: string;
};

type ActionKind = "retry" | "cancel";
type StatusFilterValue = "all" | TakeoffJobStatus;
type LevelFilterValue = "all" | TakeoffLevel;
type PeriodFilterValue = "all" | TakeoffJobListPeriod;

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilterValue; label: string }> = [
  { value: "all", label: "Tous les statuts" },
  { value: "pending", label: "En attente" },
  { value: "processing", label: "En cours" },
  { value: "completed", label: "Termine" },
  { value: "failed", label: "Echoue" },
  { value: "canceled", label: "Annule" },
  { value: "applied", label: "Applique" },
];

const LEVEL_FILTER_OPTIONS: Array<{ value: LevelFilterValue; label: string }> = [
  { value: "all", label: "Tous niveaux" },
  { value: "A", label: "Niveau A" },
  { value: "B", label: "Niveau B" },
  { value: "C", label: "Niveau C" },
];

const PERIOD_FILTER_OPTIONS: Array<{ value: PeriodFilterValue; label: string }> = [
  { value: "all", label: "Toutes periodes" },
  { value: "7d", label: "7 jours" },
  { value: "30d", label: "30 jours" },
  { value: "90d", label: "90 jours" },
];

const TAKEOFF_MAX_LIST_OFFSET = 10_000;
const TAKEOFF_LIST_REFRESH_INTERVAL_MS = 20_000;
const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const STATUS_CSS_MAP: Record<string, string> = {
  pending: "status-draft",
  processing: "status-sent",
  completed: "status-confirmed",
  failed: "status-canceled",
  canceled: "status-canceled",
  applied: "status-accepted",
};

const STATUS_LABEL_MAP: Record<string, string> = {
  pending: "En attente",
  processing: "En cours",
  completed: "Termine",
  failed: "Echoue",
  canceled: "Annule",
  applied: "Applique",
};

function getStatusLabel(status: string) {
  return STATUS_LABEL_MAP[status] ?? status;
}

function getStatusCss(status: string) {
  return STATUS_CSS_MAP[status] ?? "status-draft";
}

function formatTimestamp(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("fr-FR");
}

function formatDurationMs(ms: number | null) {
  if (ms === null || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatCostCents(cents: number | null) {
  if (cents === null || !Number.isFinite(cents)) return "-";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

function formatCount(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("fr-FR").format(value);
}

function resolveErrorTitle(status: number | null) {
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

function CounterCard({ label, value }: { label: string; value: number }) {
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

function JobsTableSkeleton() {
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

export default function TakeoffJobList({ versionId }: TakeoffJobListProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [levelFilter, setLevelFilter] = useState<LevelFilterValue>("all");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>("all");
  const [pageSize, setPageSize] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<Record<string, ActionKind>>({});
  const maxNavigablePagesByOffset =
    resolveTakeoffMaxNavigablePagesByOffset(pageSize);
  const requestPage = Math.min(currentPage, maxNavigablePagesByOffset);

  const listQuery = useMemo(() => {
    const offset = (requestPage - 1) * pageSize;
    return {
      estimate_version_id: versionId,
      status: statusFilter === "all" ? undefined : statusFilter,
      level: levelFilter === "all" ? undefined : levelFilter,
      period: periodFilter === "all" ? undefined : periodFilter,
      limit: pageSize,
      offset,
    };
  }, [
    requestPage,
    levelFilter,
    pageSize,
    periodFilter,
    statusFilter,
    versionId,
  ]);

  const swrKey = useMemo(
    () => [
      "takeoff-job-list",
      versionId,
      listQuery.status ?? "all",
      listQuery.level ?? "all",
      listQuery.period ?? "all",
      listQuery.limit,
      listQuery.offset,
    ],
    [
      listQuery.level,
      listQuery.limit,
      listQuery.offset,
      listQuery.period,
      listQuery.status,
      versionId,
    ]
  );

  const fetchJobs = useCallback(() => listTakeoffJobs(listQuery), [listQuery]);

  const computeRefreshInterval = useCallback(resolveTakeoffJobsRefreshInterval, []);

  const { data, error, isLoading, isValidating, mutate } = useSWR(swrKey, fetchJobs, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshInterval: computeRefreshInterval,
    keepPreviousData: true,
  });

  const totalJobs = data?.pagination.total ?? 0;
  const totalPagesByData = Math.max(1, Math.ceil(totalJobs / pageSize));
  const totalPages = Math.max(
    1,
    Math.min(totalPagesByData, maxNavigablePagesByOffset)
  );
  const effectivePage = Math.min(currentPage, totalPages);

  useEffect(() => {
    if (currentPage !== effectivePage) {
      setCurrentPage(effectivePage);
    }
  }, [currentPage, effectivePage]);

  const handleAction = useCallback(
    async (jobId: string, action: ActionKind) => {
      setActionError(null);
      setPendingActions((current) => ({
        ...current,
        [jobId]: action,
      }));

      try {
        if (action === "retry") {
          await retryTakeoffJob(jobId);
        } else {
          await cancelTakeoffJob(jobId);
        }
        await mutate();
      } catch (err) {
        setActionError(
          isTakeoffApiError(err)
            ? err.message
            : action === "retry"
              ? "Impossible de relancer ce job."
              : "Impossible d'annuler ce job."
        );
      } finally {
        setPendingActions((current) => {
          const next = { ...current };
          delete next[jobId];
          return next;
        });
      }
    },
    [mutate]
  );

  const errorStatus = isTakeoffApiError(error) ? error.status : null;
  const errorMessage =
    isTakeoffApiError(error) && error.message
      ? error.message
      : "Impossible de charger la liste des jobs takeoff.";

  if (error && !data) {
    return (
      <section className="dashboard-card mt-6 p-6">
        <h2 className="text-xl font-black text-[var(--slate-800)]">
          {resolveErrorTitle(errorStatus)}
        </h2>
        <p className="mt-2 text-sm text-[var(--slate-600)]">{errorMessage}</p>
      </section>
    );
  }

  const jobs = data?.jobs ?? [];
  const counters = data?.counters ?? {
    total: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    canceled: 0,
  };

  return (
    <section className="mt-6 space-y-4 animate-fade-in">
      <section className="dashboard-card p-5 sm:p-6">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="form-label" htmlFor="takeoff-status-filter">
              Statut
            </label>
            <select
              id="takeoff-status-filter"
              className="form-input form-select form-input--sm"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as StatusFilterValue);
                setCurrentPage(1);
              }}
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label" htmlFor="takeoff-level-filter">
              Niveau
            </label>
            <select
              id="takeoff-level-filter"
              className="form-input form-select form-input--sm"
              value={levelFilter}
              onChange={(event) => {
                setLevelFilter(event.target.value as LevelFilterValue);
                setCurrentPage(1);
              }}
            >
              {LEVEL_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label" htmlFor="takeoff-period-filter">
              Periode
            </label>
            <select
              id="takeoff-period-filter"
              className="form-input form-select form-input--sm"
              value={periodFilter}
              onChange={(event) => {
                setPeriodFilter(event.target.value as PeriodFilterValue);
                setCurrentPage(1);
              }}
            >
              {PERIOD_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <CounterCard label="Total" value={counters.total} />
          <CounterCard label="En cours" value={counters.processing} />
          <CounterCard label="Termines" value={counters.completed} />
          <CounterCard label="Echoues" value={counters.failed} />
          <CounterCard label="Annules" value={counters.canceled} />
        </div>
      </section>

      {actionError ? (
        <div
          className="rounded-xl border border-[var(--error)] bg-[var(--error-light)] p-3 text-sm text-[var(--error)]"
          role="alert"
        >
          {actionError}
        </div>
      ) : null}

      {isLoading && !data ? <JobsTableSkeleton /> : null}

      {!isLoading || data ? (
        <section className="dashboard-card overflow-hidden">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Niveau</th>
                  <th>Statut</th>
                  <th>Date</th>
                  <th>Duree</th>
                  <th>Items</th>
                  <th>Cout</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center text-sm text-[var(--slate-500)]">
                      Aucun job trouve pour ces filtres.
                    </td>
                  </tr>
                ) : (
                  jobs.map((job) => {
                    const pendingAction = pendingActions[job.id];
                    const canRetry =
                      job.status === "failed" &&
                      job.retry_count < TAKEOFF_JOB_MAX_RETRY_COUNT;
                    const canCancel =
                      job.status === "pending" || job.status === "processing";
                    const reviewEnabled =
                      job.status === "completed" || job.status === "applied";
                    const compareCandidate = jobs.find((candidate) => {
                      if (candidate.id === job.id) return false;
                      if (
                        candidate.status !== "completed" &&
                        candidate.status !== "applied"
                      ) {
                        return false;
                      }

                      const candidateFileName =
                        candidate.source_file_name?.trim().toLowerCase() ?? "";
                      const currentFileName =
                        job.source_file_name?.trim().toLowerCase() ?? "";

                      return (
                        candidateFileName.length > 0 &&
                        candidateFileName === currentFileName
                      );
                    });
                    const compareEnabled =
                      reviewEnabled && compareCandidate !== undefined;

                    return (
                      <tr key={job.id}>
                        <td>
                          <div className="font-medium text-[var(--slate-800)]">
                            {job.source_file_name ?? "Fichier inconnu"}
                          </div>
                          <div className="mt-1 text-xs text-[var(--slate-500)]">
                            {job.source_file_type ?? "Type non renseigne"}
                          </div>
                        </td>
                        <td>{job.level}</td>
                        <td>
                          <span className={`status-badge ${getStatusCss(job.status)}`}>
                            {getStatusLabel(job.status)}
                          </span>
                        </td>
                        <td>{formatTimestamp(job.created_at)}</td>
                        <td>{formatDurationMs(job.metrics.duration_ms)}</td>
                        <td>{formatCount(job.items_count)}</td>
                        <td>{formatCostCents(job.metrics.cost_cents)}</td>
                        <td>
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={`/dashboard/estimates/${versionId}/takeoff/${job.id}`}
                              className="btn btn-secondary btn-sm"
                            >
                              Detail
                            </Link>
                            {reviewEnabled ? (
                              <Link
                                href={`/dashboard/estimates/${versionId}/takeoff/${job.id}/review`}
                                className="btn btn-secondary btn-sm"
                              >
                                Review
                              </Link>
                            ) : null}
                            {compareEnabled ? (
                              <Link
                                href={`/dashboard/estimates/${versionId}/takeoff/${job.id}/review?view=compare&compareWith=${encodeURIComponent(
                                  compareCandidate.id
                                )}`}
                                className="btn btn-secondary btn-sm"
                              >
                                Comparer
                              </Link>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                void handleAction(job.id, "retry");
                              }}
                              disabled={!canRetry || Boolean(pendingAction)}
                            >
                              {pendingAction === "retry" ? "Relance..." : "Relancer"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                void handleAction(job.id, "cancel");
                              }}
                              disabled={!canCancel || Boolean(pendingAction)}
                            >
                              {pendingAction === "cancel" ? "Annulation..." : "Annuler"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--slate-200)] p-4">
            <p className="text-sm text-[var(--slate-500)]">
              {formatCount(totalJobs)} jobs
              {isValidating ? " (actualisation...)" : ""}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-semibold text-[var(--slate-500)]" htmlFor="takeoff-page-size">
                Page size
              </label>
              <select
                id="takeoff-page-size"
                className="form-input form-select form-input--sm h-9 min-w-[88px]"
                value={pageSize}
                onChange={(event) => {
                  const next = Number.parseInt(event.target.value, 10);
                  if (!Number.isFinite(next) || !PAGE_SIZE_OPTIONS.includes(next as (typeof PAGE_SIZE_OPTIONS)[number])) {
                    return;
                  }
                  setPageSize(next);
                  setCurrentPage(1);
                }}
              >
                {PAGE_SIZE_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}
                disabled={effectivePage <= 1}
              >
                Precedent
              </button>
              <span className="text-sm text-[var(--slate-600)]">
                Page {effectivePage} / {totalPages}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setCurrentPage((value) => Math.min(totalPages, value + 1))}
                disabled={effectivePage >= totalPages}
              >
                Suivant
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </section>
  );
}
