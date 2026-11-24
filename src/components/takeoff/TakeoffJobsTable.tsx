"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useSWRConfig } from "swr";
import { getTakeoffOperatorStateLabel } from "@/lib/takeoff/operator-state";
import { TakeoffJobActions, TakeoffJobResumeDetails, type ActionKind } from "./TakeoffJobActions";
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
import { describeTakeoffTrackingStatus } from "@/lib/takeoff/job-list-labels";
import type { TakeoffActivityCenterJobRow } from "@/lib/takeoff/types";
import { Badge } from "@/components/ui/badge";
import {
  PAGE_SIZE_OPTIONS,
  formatCount,
  formatTimestamp,
  getConfidenceBadgeVariant,
  getProcessingStrategyLabel,
  getProviderBatchStateLabel,
  getStatusCss,
  formatActivityPlan,
  isCoverageLow,
} from "@/components/takeoff/takeoff-job-list-shared";
import { buttonVariants } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";

type RowProps = {
  job: TakeoffActivityCenterJobRow;
  projectId: string;
  pendingAction?: ActionKind;
  onAction: (jobId: string, action: ActionKind) => Promise<void>;
};

const rowCell = "min-w-0 align-top wrap-anywhere max-md:block max-md:!border-0 max-md:!px-0 max-md:!py-0";
const disclosure = "w-fit cursor-pointer rounded text-xs font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function TakeoffTrackingRow({ job, projectId, pendingAction, onAction }: RowProps) {
  const plans = job.plans ?? [];
  const previous = job.previousAttempts ?? [];
  const automaticStart = takeoffExpectsAutomaticStart(job) && (job.dispatchStatus === "queued" || job.dispatchStatus === "trigger_failed");
  const status = describeTakeoffTrackingStatus({
    status: job.technicalStatusRaw, fallback: job.statusLabel, errorCode: job.errorCode,
    notStarted: job.notStarted, automaticStart,
  });
  const hasResult = job.technicalStatusRaw === "completed" || job.technicalStatusRaw === "applied";
  const batchProgress = job.processingStrategy === "batch" && takeoffShowsBatchProgress(job);
  const operatorLabel = batchProgress && job.operatorState && job.operatorState !== "none" && job.operatorState !== "orphan_to_reconcile"
    ? getTakeoffOperatorStateLabel(job.operatorState) : null;

  return (
    <tr role="row" data-testid={`takeoff-tracking-job-${job.jobId}`}
      className="max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-2 max-md:rounded-lg max-md:border max-md:border-border max-md:p-3">
      <th scope="row" role="rowheader" className={`${rowCell} text-left font-normal max-md:col-span-2`}>
        <div className="space-y-1">
          <p className="font-semibold text-foreground">
            {plans.length > 0 ? plans.map(formatActivityPlan).join(" · ") : "Fichier non renseigné"}
          </p>
          {job.estimateVersionId ? <p className="text-xs text-muted-foreground">Devis {job.versionLabel}</p> : null}
          {job.carriedOverFrom ? <p className="text-xs text-muted-foreground">Repris de {job.carriedOverFrom}</p> : null}
          <details className="text-xs text-muted-foreground">
            <summary className={disclosure}>Détails</summary>
            <div className="mt-1.5 space-y-1 pb-1">
              {job.planSetLabel ? <p>Jeu de plans : {job.planSetLabel}</p> : null}
              <p>Niveau d’analyse : {job.levelLabel}</p>
              {job.processingStrategy ? <p>Mode de traitement : {getProcessingStrategyLabel(job.processingStrategy)}</p> : null}
              {job.model ? <p>Modèle : {job.model}</p> : null}
              {job.reasoningEffort ? <p>Effort de raisonnement : {job.reasoningEffort}</p> : null}
              {batchProgress ? <p>{getProviderBatchStateLabel({ strategy: job.processingStrategy, state: job.providerBatchState })}</p> : null}
              {operatorLabel ? <p>{operatorLabel}</p> : null}
              {automaticStart && job.dispatchCorrelationId ? (
                <p>Démarrage différé · Suivi {job.dispatchCorrelationId}</p>
              ) : null}
              <TakeoffJobResumeDetails job={job} />
            </div>
          </details>
          {previous.length > 0 ? (
            <details>
              <summary className={disclosure}>
                {formatCount(previous.length)} {previous.length === 1 ? "tentative précédente" : "tentatives précédentes"}
              </summary>
              <ul className="mt-1.5 space-y-1.5 pb-1 text-xs">
                {previous.map((attempt) => (
                  <li key={attempt.jobId}>
                    <Link className="text-primary underline underline-offset-2" href={`/dashboard/affaires/${projectId}/takeoff?job=${attempt.jobId}`}>
                      {formatTimestamp(attempt.createdAt)} · {attempt.statusLabel}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </th>
      <td role="cell" className={`${rowCell} max-md:col-span-2`}>
        <span className={`status-badge ${getStatusCss(job.statusRaw)} !whitespace-normal`}>{status}</span>
      </td>
      <td role="cell" className={`${rowCell} max-md:col-span-2 max-md:empty:hidden`}>{hasResult || job.itemCount > 0 ? (
        <div className="space-y-1">
          <p className="font-medium text-foreground">
            {formatCount(job.itemCount)} {job.itemCount === 1 ? "ligne de métré extraite" : "lignes de métré extraites"}
          </p>
          {hasResult && job.confidenceLabel !== "Inconnue" ? (
            <Badge variant={getConfidenceBadgeVariant(job.confidenceLabel)} size="sm">
              Confiance : {job.confidenceLabel.toLocaleLowerCase("fr-FR")}
            </Badge>
          ) : null}
          {job.neverApplied || job.appliedCount > 0 ? (
            <p className="text-xs text-muted-foreground">{job.neverApplied ? "Pas encore envoyé au devis" : "Reporté au devis"}</p>
          ) : null}
          {job.coveragePercent !== null ? (
            <p className={`text-xs ${isCoverageLow(job.coveragePercent) ? "text-danger" : "text-muted-foreground"}`}>
              Couverture DPGF : {job.coveragePercent} %
            </p>
          ) : null}
          {job.exceptionCount > 0 ? (
            <p className="text-xs text-warning">
              {formatCount(job.exceptionCount)} {job.exceptionCount === 1 ? "exception DPGF traitée" : "exceptions DPGF traitées"}
            </p>
          ) : null}
        </div>
      ) : null}</td>
      <td role="cell" className={`${rowCell} max-md:self-center`}>
        <time className="text-xs text-muted-foreground" dateTime={job.createdAt}>
          <span className="md:hidden">Lancée le </span>{formatTimestamp(job.createdAt)}
        </time>
      </td>
      <td role="cell" className={`${rowCell} max-md:justify-self-end max-md:empty:hidden`}>
        <TakeoffJobActions job={job} projectId={projectId} pendingAction={pendingAction} onAction={onAction} />
      </td>
    </tr>
  );
}

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
          <table className="data-table table-fixed max-md:block" role="table" aria-label="Analyses de plans">
            <thead className="max-md:sr-only" role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader" className="w-[29%]">Plan ou fichier</th>
                <th scope="col" role="columnheader" className="w-[26%]">État</th>
                <th scope="col" role="columnheader">Résultat</th>
                <th scope="col" role="columnheader" className="w-[13%]">Date de lancement</th>
                <th scope="col" role="columnheader" className="w-[14%]">Actions</th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="max-md:block max-md:space-y-3 max-md:p-3">
              {jobs.map((job) => (
                <TakeoffTrackingRow
                  key={job.jobId} job={job} projectId={projectId} pendingAction={pendingActions[job.jobId]} onAction={handleAction}
                />
              ))}
            </tbody>
          </table>

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
