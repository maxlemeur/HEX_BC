"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useSWRConfig } from "swr";

import {
  cancelTakeoffJob,
  isTakeoffApiError,
  retryTakeoffJob,
  type TakeoffActivityCenterResponse,
} from "@/lib/takeoff/client";
import { TAKEOFF_JOB_MAX_RETRY_COUNT } from "@/lib/takeoff/types";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  CounterCard,
  PAGE_SIZE_OPTIONS,
  formatCount,
  formatTimestamp,
  getConfidenceBadgeVariant,
  getProcessingStrategyLabel,
  getProviderBatchStateBadgeVariant,
  getProviderBatchStateLabel,
  getStatusCss,
  isCoverageLow,
} from "@/components/takeoff/takeoff-job-list-shared";

type Props = {
  projectId: string;
  data: TakeoffActivityCenterResponse;
  onPageChange: (offset: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSize: number;
};

type ActionKind = "retry" | "cancel";

export default function TakeoffJobsTable({
  projectId,
  data,
  onPageChange,
  onPageSizeChange,
  pageSize,
}: Props) {
  const { mutate } = useSWRConfig();
  const [pendingActions, setPendingActions] = useState<
    Record<string, ActionKind>
  >({});
  const [actionError, setActionError] = useState<string | null>(null);

  const handleAction = useCallback(
    async (jobId: string, action: ActionKind) => {
      setActionError(null);
      setPendingActions((current) => ({ ...current, [jobId]: action }));

      try {
        if (action === "retry") {
          await retryTakeoffJob(jobId);
        } else {
          await cancelTakeoffJob(jobId);
        }
        // Revalidate activity center data after successful mutation
        await mutate(
          (key: unknown) =>
            Array.isArray(key) && key[0] === "activity-center",
          undefined,
          { revalidate: true }
        );
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

  const { jobs } = data;

  const renderJobActions = (
    job: TakeoffActivityCenterResponse["jobs"][number],
    pendingAction: ActionKind | undefined,
    canRetry: boolean,
    canCancel: boolean,
    reviewEnabled: boolean
  ) => (
    <div className="flex flex-wrap gap-2">
      <Link
        href={`/dashboard/estimates/${job.estimateVersionId}/takeoff/${job.jobId}`}
        className="btn btn-secondary btn-sm"
      >
        Detail
      </Link>
      {reviewEnabled ? (
        <Link
          href={`/dashboard/affaires/${projectId}/takeoff/${job.jobId}/review?versionId=${job.estimateVersionId}`}
          className="btn btn-secondary btn-sm"
        >
          Review
        </Link>
      ) : null}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => {
          void handleAction(job.jobId, "retry");
        }}
        disabled={!canRetry || Boolean(pendingAction)}
      >
        {pendingAction === "retry" ? "Relance..." : "Relancer"}
      </button>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => {
          void handleAction(job.jobId, "cancel");
        }}
        disabled={!canCancel || Boolean(pendingAction)}
      >
        {pendingAction === "cancel" ? "Annulation..." : "Annuler"}
      </button>
    </div>
  );

  return (
    <div>
      {/* Counter cards */}
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-3 mb-4"
        aria-live="polite"
      >
        <CounterCard
          label="Jobs techniques"
          value={data.counters.technicalJobs}
        />
        <CounterCard
          label="Jobs exploitables"
          value={data.counters.usableJobs}
        />
        <CounterCard
          label="Exceptions bloquantes"
          value={data.counters.blockingExceptionsJobs}
        />
      </div>

      {actionError ? (
        <div
          className="rounded-xl border border-[var(--error)] bg-[var(--error-light)] p-3 text-sm text-[var(--error)] mb-4"
          role="alert"
        >
          {actionError}
        </div>
      ) : null}

      {jobs.length === 0 ? (
        <EmptyState
          icon={
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          }
          title="Aucune analyse trouvee"
          description="Aucune analyse trouvee pour ces filtres."
        />
      ) : (
        <section className="dashboard-card overflow-hidden">
          <div className="space-y-3 p-4 md:hidden">
            {jobs.map((job) => {
              const pendingAction = pendingActions[job.jobId];
              const canRetry =
                job.technicalStatusRaw === "failed" &&
                job.retryCount < TAKEOFF_JOB_MAX_RETRY_COUNT;
              const canCancel =
                job.technicalStatusRaw === "pending" ||
                job.technicalStatusRaw === "processing";
              const reviewEnabled =
                job.statusRaw === "completed" ||
                job.statusRaw === "review_required";

              return (
                <article
                  key={job.jobId}
                  className="rounded-xl border border-[var(--slate-200)] bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="inline-flex items-center rounded-full bg-[var(--slate-100)] px-2 py-0.5 text-xs font-semibold text-[var(--slate-700)]">
                        {job.versionLabel}
                      </span>
                      {job.carriedOverFrom ? (
                        <p className="mt-1 text-xs text-[var(--slate-400)]">
                          Repris de {job.carriedOverFrom}
                        </p>
                      ) : null}
                    </div>
                    <Badge
                      variant={getConfidenceBadgeVariant(job.confidenceLabel)}
                    >
                      {job.confidenceLabel}
                    </Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span
                      className={`status-badge ${getStatusCss(job.statusRaw)}`}
                    >
                      {job.statusLabel}
                    </span>
                    <Badge variant="neutral" size="sm">
                      {job.levelLabel}
                    </Badge>
                    <Badge variant="neutral" size="sm">
                      {getProcessingStrategyLabel(job.processingStrategy)}
                    </Badge>
                    <Badge
                      variant={getProviderBatchStateBadgeVariant(
                        job.providerBatchState
                      )}
                      size="sm"
                    >
                      {getProviderBatchStateLabel({
                        strategy: job.processingStrategy,
                        state: job.providerBatchState,
                      })}
                    </Badge>
                    {job.neverApplied ? (
                      <Badge variant="warning" size="sm">
                        Jamais applique
                      </Badge>
                    ) : null}
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
                        Source
                      </dt>
                      <dd className="mt-1 text-[var(--slate-800)]">
                        {job.planSetLabel ?? "-"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
                        Date
                      </dt>
                      <dd className="mt-1 text-[var(--slate-800)]">
                        {formatTimestamp(job.createdAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
                        Items
                      </dt>
                      <dd className="mt-1 text-[var(--slate-800)]">
                        {formatCount(job.itemCount)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
                        Couverture
                      </dt>
                      <dd
                        className={`mt-1 ${isCoverageLow(job.coveragePercent) ? "text-[var(--error)]" : "text-[var(--slate-800)]"}`}
                      >
                        {job.coveragePercent}%
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
                        Exceptions
                      </dt>
                      <dd
                        className={`mt-1 ${job.exceptionCount > 0 ? "text-[var(--warning)] font-semibold" : "text-[var(--slate-800)]"}`}
                      >
                        {job.exceptionCount}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-4">
                    {renderJobActions(
                      job,
                      pendingAction,
                      canRetry,
                      canCancel,
                      reviewEnabled
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Source</th>
                  <th>Niveau</th>
                  <th>Strategie</th>
                  <th>Etat provider</th>
                  <th>Statut</th>
                  <th>Date</th>
                  <th>Items</th>
                  <th>Couverture</th>
                  <th>Confiance</th>
                  <th>Exceptions</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const pendingAction = pendingActions[job.jobId];
                  const canRetry =
                    job.technicalStatusRaw === "failed" &&
                    job.retryCount < TAKEOFF_JOB_MAX_RETRY_COUNT;
                  const canCancel =
                    job.technicalStatusRaw === "pending" ||
                    job.technicalStatusRaw === "processing";
                  const reviewEnabled =
                    job.statusRaw === "completed" ||
                    job.statusRaw === "review_required";

                  return (
                    <tr key={job.jobId}>
                      <td>
                        <span className="inline-flex items-center rounded-full bg-[var(--slate-100)] px-2 py-0.5 text-xs font-semibold text-[var(--slate-700)]">
                          {job.versionLabel}
                        </span>
                        {job.carriedOverFrom && (
                          <span className="mt-0.5 block text-xs text-[var(--slate-400)]">
                            Repris de {job.carriedOverFrom}
                          </span>
                        )}
                      </td>
                      <td>{job.planSetLabel ?? "-"}</td>
                      <td>{job.levelLabel}</td>
                      <td>
                        <Badge variant="neutral" size="sm">
                          {getProcessingStrategyLabel(job.processingStrategy)}
                        </Badge>
                      </td>
                      <td>
                        <Badge
                          variant={getProviderBatchStateBadgeVariant(
                            job.providerBatchState
                          )}
                          size="sm"
                        >
                          {getProviderBatchStateLabel({
                            strategy: job.processingStrategy,
                            state: job.providerBatchState,
                          })}
                        </Badge>
                      </td>
                      <td>
                        <span
                          className={`status-badge ${getStatusCss(job.statusRaw)}`}
                        >
                          {job.statusLabel}
                        </span>
                        {job.neverApplied && (
                          <Badge
                            variant="warning"
                            size="sm"
                            className="ml-1"
                          >
                            Jamais applique
                          </Badge>
                        )}
                      </td>
                      <td>{formatTimestamp(job.createdAt)}</td>
                      <td>{formatCount(job.itemCount)}</td>
                      <td
                        className={
                          isCoverageLow(job.coveragePercent)
                            ? "!text-[var(--error)]"
                            : ""
                        }
                      >
                        {job.coveragePercent}%
                      </td>
                      <td>
                        <Badge
                          variant={getConfidenceBadgeVariant(
                            job.confidenceLabel
                          )}
                        >
                          {job.confidenceLabel}
                        </Badge>
                      </td>
                      <td
                        className={
                          job.exceptionCount > 0
                            ? "!text-[var(--warning)] font-semibold"
                            : ""
                        }
                      >
                        {job.exceptionCount}
                      </td>
                      <td>
                        {renderJobActions(
                          job,
                          pendingAction,
                          canRetry,
                          canCancel,
                          reviewEnabled
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--slate-200)] p-4">
            <p className="text-sm text-[var(--slate-500)]">
              {formatCount(data.pagination.total)} analyses
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label
                htmlFor="ac-page-size"
                className="text-xs font-semibold text-[var(--slate-500)]"
              >
                Taille
              </label>
              <select
                id="ac-page-size"
                className="form-input form-select form-input--sm h-9 min-w-[88px]"
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
              >
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-secondary btn-sm"
                disabled={data.pagination.offset === 0}
                onClick={() =>
                  onPageChange(
                    Math.max(0, data.pagination.offset - pageSize)
                  )
                }
              >
                Precedent
              </button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={
                  data.pagination.offset + pageSize >= data.pagination.total
                }
                onClick={() =>
                  onPageChange(data.pagination.offset + pageSize)
                }
              >
                Suivant
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
