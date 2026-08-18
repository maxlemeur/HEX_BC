"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useSWRConfig } from "swr";

import {
  cancelTakeoffJob,
  isTakeoffApiError,
  reconcileTakeoffJob,
  resubmitTakeoffJob,
  type TakeoffActivityCenterResponse,
} from "@/lib/takeoff/client";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  CounterCard,
  PAGE_SIZE_OPTIONS,
  formatCount,
  formatTimestamp,
  getConfidenceBadgeVariant,
  getOperatorStateBadgeVariant,
  getProcessingStrategyLabel,
  getProviderBatchStateBadgeVariant,
  getProviderBatchStateLabel,
  getStatusCss,
  isCoverageLow,
} from "@/components/takeoff/takeoff-job-list-shared";

type Props = {
  projectId: string;
  data: TakeoffActivityCenterResponse;
  emptyState?: {
    title: string;
    description: string;
    actionLabel?: string;
    actionHref?: string;
    onAction?: () => void;
  };
  onPageChange: (offset: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSize: number;
};

type ActionKind = "reconcile" | "resubmit" | "cancel";

export default function TakeoffJobsTable({
  projectId,
  data,
  emptyState,
  onPageChange,
  onPageSizeChange,
  pageSize,
}: Props) {
  const { mutate } = useSWRConfig();
  const [pendingActions, setPendingActions] = useState<
    Record<string, ActionKind>
  >({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const handleAction = useCallback(
    async (jobId: string, action: ActionKind) => {
      setActionError(null);
      setActionNotice(null);
      setPendingActions((current) => ({ ...current, [jobId]: action }));

      try {
        if (action === "reconcile") {
          const response = await reconcileTakeoffJob(jobId);
          if (response.dispatch?.status === "persistence_unconfirmed") {
            setActionNotice(
              `Réconciliation créée, mais sa reprise automatique n'a pas pu être confirmée. Réessayez depuis ce job (suivi ${response.dispatch.correlation_id}).`
            );
          } else if (response.dispatch?.status === "queued_for_recovery") {
            setActionNotice(
              `Réconciliation enregistrée. Le démarrage immédiat a échoué ; la reprise automatique est active (suivi ${response.dispatch.correlation_id}).`
            );
          }
        } else if (action === "resubmit") {
          const response = await resubmitTakeoffJob(jobId);
          if (response.dispatch?.status === "persistence_unconfirmed") {
            setActionNotice(
              `Nouvelle soumission créée, mais sa reprise automatique n'a pas pu être confirmée. Réessayez depuis ce job (suivi ${response.dispatch.correlation_id}).`
            );
          } else if (response.dispatch?.status === "queued_for_recovery") {
            setActionNotice(
              `Nouvelle soumission enregistrée. Le démarrage immédiat a échoué ; la reprise automatique est active (suivi ${response.dispatch.correlation_id}).`
            );
          }
        } else {
          await cancelTakeoffJob(jobId);
        }
        // Revalidate activity center data after successful mutation
        await mutate(
          (key: unknown) => Array.isArray(key) && key[0] === "activity-center",
          undefined,
          { revalidate: true }
        );
      } catch (err) {
        setActionError(
          isTakeoffApiError(err)
            ? err.message
            : action === "reconcile"
              ? "Impossible de relancer la réconciliation de cette analyse."
              : action === "resubmit"
                ? "Impossible de soumettre à nouveau cette analyse."
              : "Impossible d'annuler cette analyse."
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
  const hasAnalyses = jobs.length > 0 || data.pagination.total > 0;

  const renderJobActions = (
    job: TakeoffActivityCenterResponse["jobs"][number],
    pendingAction: ActionKind | undefined,
    canReconcile: boolean,
    canResubmit: boolean,
    canCancel: boolean,
    reviewEnabled: boolean
  ) => (
    <div className="flex flex-wrap gap-2">
      <Link
        href={`/dashboard/estimates/${job.estimateVersionId}/takeoff/${job.jobId}`}
        className="btn btn-secondary btn-sm"
      >
        Détail
      </Link>
      {reviewEnabled ? (
        <Link
          href={`/dashboard/affaires/${projectId}/takeoff/${job.jobId}/review?versionId=${job.estimateVersionId}`}
          className="btn btn-secondary btn-sm"
        >
          Revue
        </Link>
      ) : null}
      {canReconcile ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            void handleAction(job.jobId, "reconcile");
          }}
          disabled={Boolean(pendingAction)}
        >
          {pendingAction === "reconcile"
            ? "Réconciliation..."
            : "Relancer la réconciliation"}
        </button>
      ) : null}
      {canResubmit ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            void handleAction(job.jobId, "resubmit");
          }}
          disabled={Boolean(pendingAction)}
        >
          {pendingAction === "resubmit"
            ? "Nouvelle soumission..."
            : "Soumettre à nouveau"}
        </button>
      ) : null}
      {canCancel ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            void handleAction(job.jobId, "cancel");
          }}
          disabled={Boolean(pendingAction)}
        >
          {pendingAction === "cancel" ? "Annulation..." : "Annuler"}
        </button>
      ) : null}
    </div>
  );

  return (
    <div>
      {/* Counter cards */}
      {hasAnalyses ? (
        <div
          className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3"
          aria-live="polite"
        >
          <CounterCard
            label="Analyses en cours"
            value={data.counters.technicalJobs}
          />
          <CounterCard
            label="Analyses exploitables"
            value={data.counters.usableJobs}
          />
          <CounterCard
            label="Exceptions bloquantes"
            value={data.counters.blockingExceptionsJobs}
          />
        </div>
      ) : null}

      {actionError ? (
        <div
          className="rounded-xl border border-[var(--error)] bg-[var(--error-light)] p-3 text-sm text-[var(--error)] mb-4"
          role="alert"
        >
          {actionError}
        </div>
      ) : null}

      {actionNotice ? (
        <div
          className="mb-4 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning-light)] p-3 text-sm text-[var(--slate-700)]"
          role="status"
        >
          {actionNotice}
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
          title={emptyState?.title ?? "Aucune analyse trouvée"}
          description={
            emptyState?.description ?? "Aucune analyse n’est disponible."
          }
          actionLabel={emptyState?.actionLabel}
          actionHref={emptyState?.actionHref}
          onAction={emptyState?.onAction}
          className="px-4 py-10 sm:px-6 sm:py-12"
        />
      ) : (
        <section className="dashboard-card overflow-hidden">
          <div className="space-y-3 p-4 md:hidden">
            {jobs.map((job) => {
              const pendingAction = pendingActions[job.jobId];
              const canReconcile = job.canReconcile ?? false;
              const canResubmit = job.canResubmit ?? false;
              const canCancel = job.canCancel ?? false;
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
                    {job.operatorState && job.operatorState !== "none" ? (
                      <Badge
                        variant={getOperatorStateBadgeVariant(
                          job.operatorState
                        )}
                        size="sm"
                      >
                        {job.operatorStateLabel ?? job.operatorState}
                      </Badge>
                    ) : null}
                    {job.dispatchStatus === "queued" ||
                    job.dispatchStatus === "trigger_failed" ? (
                      <Badge variant="warning" size="sm">
                        Reprise automatique
                      </Badge>
                    ) : null}
                    {job.neverApplied ? (
                      <Badge variant="warning" size="sm">
                        Jamais appliqué
                      </Badge>
                    ) : null}
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    {(job.dispatchStatus === "queued" ||
                      job.dispatchStatus === "trigger_failed") &&
                    job.dispatchCorrelationId ? (
                      <div className="col-span-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-light)] p-2">
                        <dt className="text-xs font-semibold text-[var(--slate-700)]">
                          Démarrage différé
                        </dt>
                        <dd className="mt-1 text-xs text-[var(--slate-600)]">
                          La demande est conservée. Suivi {job.dispatchCorrelationId}
                        </dd>
                      </div>
                    ) : null}
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
                        Éléments
                      </dt>
                      <dd className="mt-1 text-[var(--slate-800)]">
                        {formatCount(job.itemCount)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
                        Couverture DPGF
                      </dt>
                      <dd
                        className={`mt-1 ${isCoverageLow(job.coveragePercent) ? "text-[var(--error)]" : "text-[var(--slate-800)]"}`}
                      >
                        {job.coveragePercent === null
                          ? "Aucun DPGF"
                          : `${job.coveragePercent}%`}
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
                      canReconcile,
                      canResubmit,
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
                  <th>Analyse</th>
                  <th>Statut</th>
                  <th>Date</th>
                  <th>Éléments</th>
                  <th>Couverture DPGF</th>
                  <th>Exceptions</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const pendingAction = pendingActions[job.jobId];
                  const canReconcile = job.canReconcile ?? false;
                  const canResubmit = job.canResubmit ?? false;
                  const canCancel = job.canCancel ?? false;
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
                      <td>
                        <div className="flex flex-col items-start gap-1.5">
                          <span className="text-sm font-medium text-[var(--slate-800)]">
                            {job.levelLabel}
                          </span>
                          <Badge variant="neutral" size="sm">
                            {getProcessingStrategyLabel(job.processingStrategy)}
                          </Badge>
                        </div>
                      </td>
                      <td>
                        <div className="flex flex-col items-start gap-1.5">
                          <span
                            className={`status-badge ${getStatusCss(job.statusRaw)}`}
                          >
                            {job.statusLabel}
                          </span>
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
                          <Badge
                            variant={getConfidenceBadgeVariant(
                              job.confidenceLabel
                            )}
                            size="sm"
                          >
                            {job.confidenceLabel}
                          </Badge>
                          {job.operatorState && job.operatorState !== "none" ? (
                            <Badge
                              variant={getOperatorStateBadgeVariant(
                                job.operatorState
                              )}
                              size="sm"
                            >
                              {job.operatorStateLabel ?? job.operatorState}
                            </Badge>
                          ) : null}
                          {job.dispatchStatus === "queued" ||
                          job.dispatchStatus === "trigger_failed" ? (
                            <Badge variant="warning" size="sm">
                              Reprise automatique
                            </Badge>
                          ) : null}
                          {job.neverApplied ? (
                            <Badge variant="warning" size="sm">
                              Jamais appliqué
                            </Badge>
                          ) : null}
                        </div>
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
                        {job.coveragePercent === null
                          ? "Aucun DPGF"
                          : `${job.coveragePercent}%`}
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
                          canReconcile,
                          canResubmit,
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
                  onPageChange(Math.max(0, data.pagination.offset - pageSize))
                }
              >
                Précédent
              </button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={
                  data.pagination.offset + pageSize >= data.pagination.total
                }
                onClick={() => onPageChange(data.pagination.offset + pageSize)}
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
