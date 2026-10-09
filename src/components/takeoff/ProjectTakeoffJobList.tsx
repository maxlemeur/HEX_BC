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
import {
  CounterCard,
  JobsTableSkeleton,
  LEVEL_FILTER_OPTIONS,
  PAGE_SIZE_OPTIONS,
  PERIOD_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
  formatCount,
  formatTimestamp,
  getStatusCss,
  getStatusLabel,
  resolveErrorTitle,
  resolveTakeoffJobsRefreshInterval,
  resolveTakeoffMaxNavigablePagesByOffset,
} from "@/components/takeoff/takeoff-job-list-shared";
import { EmptyState } from "@/components/layout/empty-state";
import TakeoffExceptionsTab from "@/components/takeoff/TakeoffExceptionsTab";
import { FileTextIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { FieldLabel } from "@/components/ui/field";
import { Card } from "@/components/ui/card";

type Props = {
  projectId: string;
  versions: Array<{ id: string; version_number: number }>;
};

type ActionKind = "retry" | "cancel";
type StatusFilterValue = "all" | TakeoffJobStatus;
type LevelFilterValue = "all" | TakeoffLevel;
type PeriodFilterValue = "all" | TakeoffJobListPeriod;
type VersionFilterValue = "all" | string;

export default function ProjectTakeoffJobList({
  projectId,
  versions,
}: Props) {
  const [versionFilter, setVersionFilter] =
    useState<VersionFilterValue>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [levelFilter, setLevelFilter] = useState<LevelFilterValue>("all");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>("all");
  const [pageSize, setPageSize] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<
    Record<string, ActionKind>
  >({});
  const maxNavigablePagesByOffset =
    resolveTakeoffMaxNavigablePagesByOffset(pageSize);
  const requestPage = Math.min(currentPage, maxNavigablePagesByOffset);

  const versionNumberMap = useMemo(
    () => new Map(versions.map((v) => [v.id, v.version_number])),
    [versions]
  );

  const versionFilterOptions = useMemo(
    () => [
      { value: "all" as const, label: "Toutes versions" },
      ...versions.map((v) => ({
        value: v.id,
        label: `V${v.version_number}`,
      })),
    ],
    [versions]
  );

  const listQuery = useMemo(() => {
    const offset = (requestPage - 1) * pageSize;

    if (versionFilter === "all") {
      return {
        project_id: projectId,
        status: statusFilter === "all" ? undefined : statusFilter,
        level: levelFilter === "all" ? undefined : levelFilter,
        period: periodFilter === "all" ? undefined : periodFilter,
        limit: pageSize,
        offset,
      };
    }

    return {
      estimate_version_id: versionFilter,
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
    projectId,
    statusFilter,
    versionFilter,
  ]);

  const swrKey = useMemo(
    () => [
      "takeoff-job-list-project",
      projectId,
      versionFilter,
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
      projectId,
      versionFilter,
    ]
  );

  const fetchJobs = useCallback(() => listTakeoffJobs(listQuery), [listQuery]);

  const computeRefreshInterval = useCallback(
    resolveTakeoffJobsRefreshInterval,
    []
  );

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    swrKey,
    fetchJobs,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      refreshInterval: computeRefreshInterval,
      keepPreviousData: true,
    }
  );

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
              ? "Impossible de relancer cette extraction."
              : "Impossible d'annuler cette extraction."
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
      : "Impossible de charger l'historique des extractions.";

  if (error && !data) {
    return (
      <Card className="mt-6 p-6">
        <h2 className="text-xl font-black text-foreground">
          {resolveErrorTitle(errorStatus)}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{errorMessage}</p>
      </Card>
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
      <Card className="p-5 sm:p-6">
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <FieldLabel
              className="mb-1.5"
              htmlFor="takeoff-version-filter"
            >
              Version
            </FieldLabel>
            <NativeSelect
              id="takeoff-version-filter"
              size="sm"
              value={versionFilter}
              onChange={(event) => {
                setVersionFilter(
                  event.target.value as VersionFilterValue
                );
                setCurrentPage(1);
              }}
            >
              {versionFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div>
            <FieldLabel
              className="mb-1.5"
              htmlFor="takeoff-status-filter"
            >
              Statut
            </FieldLabel>
            <NativeSelect
              id="takeoff-status-filter"
              size="sm"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(
                  event.target.value as StatusFilterValue
                );
                setCurrentPage(1);
              }}
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div>
            <FieldLabel
              className="mb-1.5"
              htmlFor="takeoff-level-filter"
            >
              Niveau
            </FieldLabel>
            <NativeSelect
              id="takeoff-level-filter"
              size="sm"
              value={levelFilter}
              onChange={(event) => {
                setLevelFilter(
                  event.target.value as LevelFilterValue
                );
                setCurrentPage(1);
              }}
            >
              {LEVEL_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div>
            <FieldLabel
              className="mb-1.5"
              htmlFor="takeoff-period-filter"
            >
              Période
            </FieldLabel>
            <NativeSelect
              id="takeoff-period-filter"
              size="sm"
              value={periodFilter}
              onChange={(event) => {
                setPeriodFilter(
                  event.target.value as PeriodFilterValue
                );
                setCurrentPage(1);
              }}
            >
              {PERIOD_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <CounterCard label="Total" value={counters.total} />
          <CounterCard label="En cours" value={counters.processing} />
          <CounterCard label="Terminés" value={counters.completed} />
          <CounterCard label="Échoués" value={counters.failed} />
          <CounterCard label="Annulés" value={counters.canceled} />
        </div>
      </Card>

      {actionError ? (
        <div
          className="rounded-xl border border-danger bg-danger-light p-3 text-sm text-danger"
          role="alert"
        >
          {actionError}
        </div>
      ) : null}

      {isLoading && !data ? <JobsTableSkeleton /> : null}

      {!isLoading || data ? (
        <Card className="overflow-hidden">
          <div className="table-scroll" role="region" aria-label="Extractions" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Source</th>
                  <th>Niveau</th>
                  <th>Statut</th>
                  <th>Date</th>
                  <th>Items</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-0">
                      <EmptyState
                        variant="plain"
                        icon={<FileTextIcon aria-hidden="true" />}
                        title="Aucune extraction"
                        description="Aucune extraction trouvée pour ces filtres."
                      />
                    </td>
                  </tr>
                ) : (
                  jobs.map((job) => {
                    const pendingAction = pendingActions[job.id];
                    const canRetry =
                      job.status === "failed" &&
                      job.retry_count < TAKEOFF_JOB_MAX_RETRY_COUNT &&
                      (job.can_resubmit ?? true);
                    const canCancel =
                      (job.status === "pending" ||
                        job.status === "processing") &&
                      (job.can_cancel ?? true);
                    const reviewEnabled =
                      job.status === "completed" ||
                      job.status === "applied";
                    const compareCandidate = jobs.find(
                      (candidate) => {
                        if (candidate.id === job.id) return false;
                        if (
                          candidate.status !== "completed" &&
                          candidate.status !== "applied"
                        ) {
                          return false;
                        }
                        if (
                          candidate.estimate_version_id !==
                          job.estimate_version_id
                        ) {
                          return false;
                        }
                        const candidateFileName =
                          candidate.source_file_name
                            ?.trim()
                            .toLowerCase() ?? "";
                        const currentFileName =
                          job.source_file_name
                            ?.trim()
                            .toLowerCase() ?? "";
                        return (
                          candidateFileName.length > 0 &&
                          candidateFileName === currentFileName
                        );
                      }
                    );
                    const compareEnabled =
                      reviewEnabled &&
                      compareCandidate !== undefined;

                    const resolvedVersionNumber =
                      job.version_number ??
                      versionNumberMap.get(
                        job.estimate_version_id
                      ) ??
                      null;

                    return (
                      <tr key={job.id}>
                        <td>
                          {resolvedVersionNumber !== null ? (
                            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground-secondary">
                              V{resolvedVersionNumber}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td>
                          <div className="font-medium text-foreground">
                            {job.source_file_name ??
                              "Fichier inconnu"}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {job.source_file_type ??
                              "Type non renseigné"}
                          </div>
                        </td>
                        <td>{job.level}</td>
                        <td>
                          <span
                            className={`status-badge ${getStatusCss(job.status)}`}
                          >
                            {getStatusLabel(job.status)}
                          </span>
                        </td>
                        <td>
                          {formatTimestamp(job.created_at)}
                        </td>
                        <td>{formatCount(job.items_count)}</td>
                        <td>
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={`/dashboard/estimates/${job.estimate_version_id}/takeoff/${job.id}`}
                              className={buttonVariants({ variant: "outline" })}
                            >
                              Détail
                            </Link>
                            {reviewEnabled ? (
                              <Link
                                href={`/dashboard/affaires/${projectId}/takeoff/${job.id}/review?versionId=${job.estimate_version_id}`}
                                className={buttonVariants({ variant: "outline" })}
                              >
                                Revue
                              </Link>
                            ) : null}
                            {compareEnabled ? (
                              <Link
                                href={`/dashboard/affaires/${projectId}/takeoff/${job.id}/review?versionId=${job.estimate_version_id}&view=compare&compareWith=${encodeURIComponent(
                                  compareCandidate.id
                                )}`}
                                className={buttonVariants({ variant: "outline" })}
                              >
                                Comparer
                              </Link>
                            ) : null}
                            {canRetry || pendingAction === "retry" ? (
                              <button
                                type="button"
                                className={buttonVariants({ variant: "outline" })}
                                onClick={() => {
                                  void handleAction(
                                    job.id,
                                    "retry"
                                  );
                                }}
                                disabled={
                                  !canRetry ||
                                  Boolean(pendingAction)
                                }
                              >
                                {pendingAction === "retry"
                                  ? "Relance…"
                                  : "Relancer"}
                              </button>
                            ) : null}
                            {canCancel || pendingAction === "cancel" ? (
                              <button
                                type="button"
                                className={buttonVariants({ variant: "outline" })}
                                onClick={() => {
                                  void handleAction(
                                    job.id,
                                    "cancel"
                                  );
                                }}
                                disabled={
                                  !canCancel ||
                                  Boolean(pendingAction)
                                }
                              >
                                {pendingAction === "cancel"
                                  ? "Annulation…"
                                  : "Annuler"}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
            <p className="text-sm text-muted-foreground">
              {formatCount(totalJobs)} extractions
              {isValidating ? " (actualisation...)" : ""}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <label
                className="text-xs font-semibold text-muted-foreground"
                htmlFor="takeoff-page-size"
              >
                Page size
              </label>
              <NativeSelect
                id="takeoff-page-size"
                size="sm" className="h-9 min-w-[88px]"
                value={pageSize}
                onChange={(event) => {
                  const next = Number.parseInt(
                    event.target.value,
                    10
                  );
                  if (
                    !Number.isFinite(next) ||
                    !PAGE_SIZE_OPTIONS.includes(
                      next as (typeof PAGE_SIZE_OPTIONS)[number]
                    )
                  ) {
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
              </NativeSelect>

              <button
                type="button"
                className={buttonVariants({ variant: "outline" })}
                onClick={() =>
                  setCurrentPage((value) =>
                    Math.max(1, value - 1)
                  )
                }
                disabled={effectivePage <= 1}
              >
                Précédent
              </button>
              <span className="text-sm text-muted-foreground">
                Page {effectivePage} / {totalPages}
              </span>
              <button
                type="button"
                className={buttonVariants({ variant: "outline" })}
                onClick={() =>
                  setCurrentPage((value) =>
                    Math.min(totalPages, value + 1)
                  )
                }
                disabled={effectivePage >= totalPages}
              >
                Suivant
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-foreground">
              Exceptions &amp; risques
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Provenance, confiance et signaux de risque pour la version en cours
              de revue.
            </p>
          </div>
        </div>

        <TakeoffExceptionsTab
          projectId={projectId}
          versionId={versionFilter === "all" ? null : versionFilter}
        />
      </Card>
    </section>
  );
}
