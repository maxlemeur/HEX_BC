"use client";

import { useCallback, useState } from "react";
import { useSWRConfig } from "swr";
import { getTakeoffOperatorStateLabel } from "@/lib/takeoff/operator-state";
import { TakeoffJobActions, type ActionKind } from "./TakeoffJobActions";
import {
  adoptTakeoffResume,
  readTakeoffResumeRefusal,
  takeoffExpectsAutomaticStart,
  takeoffShowsBatchProgress,
  useTakeoffResumeRefresh,
} from "./takeoff-resume-view";
import { isTakeoffRequestActivityKey } from "./useTakeoffRequestActivity";

import {
  cancelTakeoffJob,
  isTakeoffApiError,
  resubmitTakeoffJob,
  type TakeoffActivityCenterResponse,
} from "@/lib/takeoff/client";
import { Badge } from "@/components/ui/badge";
import {
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
import { buttonVariants } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";

type Props = {
  projectId: string;
  data: TakeoffActivityCenterResponse;
  onPageChange: (offset: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSize: number;
};

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
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const handleAction = useCallback(
    async (jobId: string, action: ActionKind) => {
      setActionError(null);
      setActionNotice(null);
      setPendingActions((current) => ({ ...current, [jobId]: action }));

      try {
        if (action === "resubmit") {
          const response = await resubmitTakeoffJob(jobId);
          if (response.dispatch?.status === "persistence_unconfirmed") {
            setActionNotice(
              `Nouvelle soumission créée, mais sa reprise automatique n'a pas pu être confirmée. Réessayez depuis cette analyse (suivi ${response.dispatch.correlation_id}).`
            );
          } else if (response.dispatch?.status === "queued_for_recovery") {
            setActionNotice(
              `Nouvelle soumission enregistrée. Le démarrage immédiat a échoué ; la reprise automatique est activée (suivi ${response.dispatch.correlation_id}).`
            );
          }
        } else {
          await cancelTakeoffJob(jobId);
        }
        // The list and the page's one poll (the affaire's requests and its analyses in flight) are read again: the poll
        // then follows the analysis this action queued, the list no longer polls on its own.
        await mutate(
          (key: unknown) => (Array.isArray(key) && key[0] === "activity-center") || isTakeoffRequestActivityKey(key),
          undefined,
          { revalidate: true }
        );
      } catch (err) {
        setActionError(
          isTakeoffApiError(err)
            ? err.message
            : action === "resubmit"
              ? "Impossible de soumettre à nouveau cette analyse."
              : "Impossible d'annuler cette analyse."
        );
        // A refusal carries the decision now in force: the row adopts it at once, then the list is read again (a role
        // or a state that changed since the read shows on every row).
        const decision = isTakeoffApiError(err) ? readTakeoffResumeRefusal(err.details) : null;
        const isActivityKey = (key: unknown) => Array.isArray(key) && key[0] === "activity-center";
        void (decision
          ? mutate(isActivityKey, (current?: TakeoffActivityCenterResponse) => current && adoptTakeoffResume(current, jobId, decision),
            { revalidate: true })
          : mutate(isActivityKey));
        void mutate(isTakeoffRequestActivityKey);
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

  // A wait the server announced is over: read the list again, which decides anew. Revalidate only: the rows stay on
  // screen while the list is read.
  const revalidateList = useCallback(() => {
    void mutate((key: unknown) => Array.isArray(key) && key[0] === "activity-center");
  }, [mutate]);

  const { jobs } = data;
  useTakeoffResumeRefresh(jobs, revalidateList);
  const smallestPageSize = PAGE_SIZE_OPTIONS[0];
  // Page size and paging only matter once the list runs past one short page.
  const showPaging =
    data.pagination.total > smallestPageSize ||
    pageSize !== smallestPageSize ||
    data.pagination.offset > 0;


  return (
    <div>
      {actionError ? (
        <div
          className="mx-4 mt-4 rounded-xl border border-danger bg-danger-light p-3 text-sm text-danger sm:mx-6"
          role="alert"
        >
          {actionError}
        </div>
      ) : null}

      {actionNotice ? (
        <div
          className="mx-4 mt-4 rounded-xl border border-warning-border bg-warning-light p-3 text-sm text-foreground-secondary sm:mx-6"
          role="status"
        >
          {actionNotice}
        </div>
      ) : null}

      {jobs.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground sm:px-6">
          Aucune analyse à afficher.
        </p>
      ) : (
        <div>
          <div className="space-y-3 p-4 md:hidden">
            {jobs.map((job) => {
              const pendingAction = pendingActions[job.jobId];

              return (
                <article
                  key={job.jobId}
                  className="rounded-xl border border-border bg-surface p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground-secondary">
                        {job.versionLabel}
                      </span>
                      {job.carriedOverFrom ? (
                        <p className="mt-1 text-xs text-subtle-foreground">
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
                    {job.processingStrategy === "sync" || !takeoffShowsBatchProgress(job) ? null : (
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
                    )}
                    {job.operatorState && job.operatorState !== "none" && job.operatorState !== "orphan_to_reconcile"
                      && takeoffShowsBatchProgress(job) ? (
                      <Badge
                        variant={getOperatorStateBadgeVariant(
                          job.operatorState
                        )}
                        size="sm"
                      >
                        {getTakeoffOperatorStateLabel(job.operatorState)}
                      </Badge>
                    ) : null}
                    {takeoffExpectsAutomaticStart(job) && (job.dispatchStatus === "queued" ||
                    job.dispatchStatus === "trigger_failed") ? (
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
                    {takeoffExpectsAutomaticStart(job) && (job.dispatchStatus === "queued" ||
                      job.dispatchStatus === "trigger_failed") &&
                    job.dispatchCorrelationId ? (
                      <div className="col-span-2 rounded-lg border border-warning-border bg-warning-light p-2">
                        <dt className="text-xs font-semibold text-foreground-secondary">
                          Démarrage différé
                        </dt>
                        <dd className="mt-1 text-xs text-muted-foreground">
                          La demande est conservée. Suivi {job.dispatchCorrelationId}
                        </dd>
                      </div>
                    ) : null}
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Source
                      </dt>
                      <dd className="mt-1 text-foreground">
                        {job.planSetLabel ?? "-"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Date
                      </dt>
                      <dd className="mt-1 text-foreground">
                        {formatTimestamp(job.createdAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Éléments
                      </dt>
                      <dd className="mt-1 text-foreground">
                        {formatCount(job.itemCount)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Couverture DPGF
                      </dt>
                      <dd
                        className={`mt-1 ${isCoverageLow(job.coveragePercent) ? "text-danger" : "text-foreground"}`}
                      >
                        {job.coveragePercent === null
                          ? "Aucun DPGF"
                          : `${job.coveragePercent}%`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Exceptions
                      </dt>
                      <dd
                        className={`mt-1 ${job.exceptionCount > 0 ? "text-warning font-semibold" : "text-foreground"}`}
                      >
                        {job.exceptionCount}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-4">
                    <TakeoffJobActions job={job} projectId={projectId} pendingAction={pendingAction} onAction={handleAction} />
                  </div>
                </article>
              );
            })}
          </div>

          <div
            className="relative hidden overflow-x-auto md:block"
            role="region"
            aria-label="Analyses de plans"
            tabIndex={0}
          >
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

                  return (
                    <tr key={job.jobId}>
                      <td>
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground-secondary">
                          {job.versionLabel}
                        </span>
                        {job.carriedOverFrom && (
                          <span className="mt-0.5 block text-xs text-subtle-foreground">
                            Repris de {job.carriedOverFrom}
                          </span>
                        )}
                      </td>
                      <td>{job.planSetLabel ?? "-"}</td>
                      <td>
                        <div className="flex flex-col items-start gap-1.5">
                          <span className="text-sm font-medium text-foreground">
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
                          {/* An immediate analysis has no provider batch: its badge would repeat the strategy. */}
                          {job.processingStrategy === "sync" || !takeoffShowsBatchProgress(job) ? null : (
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
                          )}
                          <Badge
                            variant={getConfidenceBadgeVariant(
                              job.confidenceLabel
                            )}
                            size="sm"
                          >
                            {job.confidenceLabel}
                          </Badge>
                          {job.operatorState && job.operatorState !== "none" && job.operatorState !== "orphan_to_reconcile"
                      && takeoffShowsBatchProgress(job) ? (
                            <Badge
                              variant={getOperatorStateBadgeVariant(
                                job.operatorState
                              )}
                              size="sm"
                            >
                              {getTakeoffOperatorStateLabel(job.operatorState)}
                            </Badge>
                          ) : null}
                          {takeoffExpectsAutomaticStart(job) && (job.dispatchStatus === "queued" ||
                          job.dispatchStatus === "trigger_failed") ? (
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
                            ? "!text-danger"
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
                            ? "!text-warning font-semibold"
                            : ""
                        }
                      >
                        {job.exceptionCount}
                      </td>
                      <td>
                        <TakeoffJobActions job={job} projectId={projectId} pendingAction={pendingAction} onAction={handleAction} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-6">
            <p className="text-sm text-muted-foreground">
              {formatCount(data.pagination.total)} analyse{data.pagination.total > 1 ? "s" : ""}
            </p>
            {showPaging ? (
              <div className="flex flex-wrap items-center gap-3">
                <label
                  htmlFor="ac-page-size"
                  className="text-xs font-semibold text-muted-foreground"
                >
                  Taille
                </label>
                <NativeSelect
                  id="ac-page-size"
                  size="sm" className="h-9 min-w-[88px]"
                  value={pageSize}
                  onChange={(e) => onPageSizeChange(Number(e.target.value))}
                >
                  {PAGE_SIZE_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </NativeSelect>
                <button
                  className={buttonVariants({ variant: "outline" })}
                  disabled={data.pagination.offset === 0}
                  onClick={() =>
                    onPageChange(Math.max(0, data.pagination.offset - pageSize))
                  }
                >
                  Précédent
                </button>
                <button
                  className={buttonVariants({ variant: "outline" })}
                  disabled={
                    data.pagination.offset + pageSize >= data.pagination.total
                  }
                  onClick={() => onPageChange(data.pagination.offset + pageSize)}
                >
                  Suivant
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
