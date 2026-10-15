"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ProductionRibbon, ProductionRibbonHeader } from "@/components/dashboard/ProductionRibbon";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserContext } from "@/components/UserContext";
import {
  TakeoffApplyWizard,
  type TakeoffApplyStrategy,
  type TakeoffApplyWizardSubmitPayload,
} from "@/components/takeoff/TakeoffApplyWizard";
import {
  isEstimateApiError,
  releaseEstimateDraftLock,
} from "@/lib/estimates/client";
import { ensureTakeoffApplyDraftLock } from "@/lib/takeoff/apply-draft-lock";
import {
  applyTakeoffJob,
  cancelTakeoffJob,
  isTakeoffApiError,
  reconcileTakeoffJob,
  resubmitTakeoffJob,
} from "@/lib/takeoff/client";
import { TAKEOFF_LOW_CONFIDENCE_THRESHOLD_FLAG_KEY } from "@/lib/takeoff/constants";
import { DEFAULT_LOW_CONFIDENCE_THRESHOLD } from "@/lib/takeoff/guards";
import { useTakeoffJobPolling } from "@/lib/takeoff/use-takeoff-job-polling";
import {
  TAKEOFF_JOB_MAX_RETRY_COUNT,
  type TakeoffJobSummary,
} from "@/lib/takeoff/types";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import {
  getOperatorStateBadgeVariant,
  getProcessingStrategyLabel,
  getProviderBatchStateLabel,
} from "@/components/takeoff/takeoff-job-list-shared";
import { LoaderCircleIcon } from "lucide-react";

type TakeoffJobMonitorProps = {
  jobId: string;
  versionId: string;
};

type ActionState = "idle" | "loading" | "error";

type ApplySuccessSummary = {
  appliedAt: string;
  versionId: string;
  sectionLabel: string;
  strategy: TakeoffApplyStrategy;
  createdCount: number;
  updatedCount: number;
  ignoredCount: number;
};

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
  completed: "Terminé",
  failed: "Échoué",
  canceled: "Annulé",
  applied: "Appliqué",
};

const STRATEGY_LABEL_MAP: Record<TakeoffApplyStrategy, string> = {
  append: "Append",
  replace: "Replace",
  merge: "Merge",
};
function getStatusCss(status: string) {
  return STATUS_CSS_MAP[status] ?? "status-draft";
}

function getStatusLabel(status: string) {
  return STATUS_LABEL_MAP[status] ?? status;
}

function getStrategyLabel(strategy: TakeoffApplyStrategy) {
  return STRATEGY_LABEL_MAP[strategy] ?? strategy;
}

function formatFileSize(bytes: number | null) {
  if (bytes === null || !Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} o`;

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} Ko`;
  }

  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(1)} Mo`;
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

function resolveErrorMessage(error: unknown, fallback: string) {
  if (isEstimateApiError(error) || isTakeoffApiError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    const trimmed = error.message.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return fallback;
}

function parseLowConfidenceThreshold(value: string | null): number {
  if (!value) return DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  if (parsed < 0 || parsed > 1) return DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  return parsed;
}

function LiveDuration({ startedAt }: { startedAt: string | null }) {
  const [elapsed, setElapsed] = useState<string>("-");
  const startMs = startedAt ? Date.parse(startedAt) : NaN;

  useEffect(() => {
    if (!Number.isFinite(startMs)) return;

    const update = () => {
      const diff = Date.now() - startMs;
      setElapsed(formatDurationMs(diff));
    };
    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, [startMs]);

  return <>{elapsed}</>;
}

function Spinner() {
  return (
    <LoaderCircleIcon className="inline-block h-4 w-4 animate-spin text-info" aria-hidden="true" />
  );
}

function SkeletonCard({ versionId }: { versionId: string }) {
  return (
    <div className="animate-fade-in">
      <ProductionRibbon ariaLabel="Ruban métier des métrés">
        <ProductionRibbonHeader
          breadcrumbs={[
            { label: "Chiffrages", href: "/dashboard/estimates" },
            { label: "Métrés", href: `/dashboard/estimates/${versionId}/takeoff` },
            { label: "Extraction" },
          ]}
          title="Extraction"
          description="Chargement…"
        />
      </ProductionRibbon>
      <Card className="p-6" role="status" aria-label="Chargement de l’extraction">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-4"
              style={{ width: `${60 + (i % 3) * 15}%` }}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function FatalError({
  versionId,
  errorStatus,
  errorMessage,
}: {
  versionId: string;
  errorStatus: number | null;
  errorMessage: string | null;
}) {
  const title =
    errorStatus === 404
      ? "Extraction introuvable"
      : errorStatus === 403
        ? "Accès refusé"
        : errorStatus === 401
          ? "Session expirée"
        : "Erreur";
  const message =
    errorMessage ?? "Une erreur est survenue lors du chargement de l’extraction.";

  return (
    <div className="animate-fade-in">
      <ProductionRibbon ariaLabel="Ruban métier des métrés">
        <ProductionRibbonHeader
          breadcrumbs={[
            { label: "Chiffrages", href: "/dashboard/estimates" },
            { label: "Métrés", href: `/dashboard/estimates/${versionId}/takeoff` },
            { label: "Extraction" },
          ]}
          title={title}
          description={message}
        />
      </ProductionRibbon>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href={`/dashboard/estimates/${versionId}`}
          className={buttonVariants({ variant: "outline" })}
        >
          Retour au chiffrage
        </Link>
        <Link
          href={`/dashboard/estimates/${versionId}/takeoff/new`}
          className={buttonVariants({ variant: "primary" })}
        >
          Nouvelle extraction
        </Link>
      </div>
    </div>
  );
}

function JobDetailsGrid({ job }: { job: TakeoffJobSummary }) {
  const isProcessing = job.status === "processing";
  const hasDuration = job.metrics.duration_ms !== null;

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <dt className="text-xs font-medium text-muted-foreground">Fichier</dt>
        <dd className="mt-1 text-sm">
          {job.source_file_name ?? "-"}
          {job.source_file_type && (
            <span className="ml-1 text-xs text-muted-foreground">
              ({job.source_file_type})
            </span>
          )}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-muted-foreground">Taille</dt>
        <dd className="mt-1 text-sm">
          {formatFileSize(job.source_file_size_bytes)}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-muted-foreground">Niveau</dt>
        <dd className="mt-1 text-sm">{job.level}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-muted-foreground">
          Stratégie
        </dt>
        <dd className="mt-1 text-sm">
          {getProcessingStrategyLabel(job.processing_strategy)}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-muted-foreground">
          État provider
        </dt>
        <dd className="mt-1 text-sm">
          {getProviderBatchStateLabel({
            strategy: job.processing_strategy,
            state: job.provider_batch_state,
          })}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-muted-foreground">
          Maj provider
        </dt>
        <dd className="mt-1 text-sm">
          {formatTimestamp(job.provider_batch_updated_at)}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-muted-foreground">ID extraction</dt>
        <dd className="mt-1 font-mono text-xs">{job.id}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-muted-foreground">
          ID batch provider
        </dt>
        <dd className="mt-1 font-mono text-xs">
          {job.provider_batch_id ?? "-"}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-muted-foreground">
          Créé le
        </dt>
        <dd className="mt-1 text-sm">{formatTimestamp(job.created_at)}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-muted-foreground">
          Démarré le
        </dt>
        <dd className="mt-1 text-sm">{formatTimestamp(job.started_at)}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-muted-foreground">
          Terminé le
        </dt>
        <dd className="mt-1 text-sm">{formatTimestamp(job.completed_at)}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-muted-foreground">Durée</dt>
        <dd className="mt-1 text-sm">
          {isProcessing && !hasDuration ? (
            <LiveDuration startedAt={job.started_at} />
          ) : (
            formatDurationMs(job.metrics.duration_ms)
          )}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-muted-foreground">
          Relances
        </dt>
        <dd className="mt-1 text-sm">
          {job.retry_count} / {TAKEOFF_JOB_MAX_RETRY_COUNT}
        </dd>
      </div>
      {job.metrics.token_count !== null && (
        <div>
          <dt className="text-xs font-medium text-muted-foreground">
            Tokens
          </dt>
          <dd className="mt-1 text-sm">
            {job.metrics.token_count.toLocaleString("fr-FR")}
          </dd>
        </div>
      )}
      {job.metrics.cost_cents !== null && (
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Coût</dt>
          <dd className="mt-1 text-sm">
            {formatCostCents(job.metrics.cost_cents)}
          </dd>
        </div>
      )}
    </dl>
  );
}

function JobErrorSection({ job }: { job: TakeoffJobSummary }) {
  if (!job.error_code && !job.error_message) return null;

  return (
    <Alert variant="danger" className="mt-4">
      <AlertDescription className="font-medium">
        {job.error_code && (
          <span className="mr-2 font-mono text-xs">[{job.error_code}]</span>
        )}
        {job.error_message ?? "Une erreur est survenue."}
      </AlertDescription>
    </Alert>
  );
}

export default function TakeoffJobMonitor({
  jobId,
  versionId,
}: TakeoffJobMonitorProps) {
  const { profile } = useUserContext();
  const isAdmin = profile?.tenant_role === "admin";
  const {
    enabled: isLowConfidenceThresholdEnabled,
    value: lowConfidenceThresholdRaw,
  } = useFeatureFlag(
    TAKEOFF_LOW_CONFIDENCE_THRESHOLD_FLAG_KEY
  );
  const lowConfidenceThreshold = parseLowConfidenceThreshold(
    isLowConfidenceThresholdEnabled ? lowConfidenceThresholdRaw : null
  );
  const { data, error, errorStatus, isPolling, refetch } =
    useTakeoffJobPolling(jobId);

  const [reconcileState, setReconcileState] = useState<ActionState>("idle");
  const [resubmitState, setResubmitState] = useState<ActionState>("idle");
  const [cancelState, setCancelState] = useState<ActionState>("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [applyState, setApplyState] = useState<ActionState>("idle");
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isApplyWizardOpen, setIsApplyWizardOpen] = useState(false);
  const [applySuccess, setApplySuccess] = useState<ApplySuccessSummary | null>(
    null
  );

  const handleReconcile = useCallback(async () => {
    setReconcileState("loading");
    setActionError(null);
    setActionNotice(null);
    try {
      const response = await reconcileTakeoffJob(jobId);
      if (response.dispatch?.status === "persistence_unconfirmed") {
        setActionNotice(
          `Réconciliation créée, mais la reprise automatique n'a pas pu être confirmée. Réessayez (suivi ${response.dispatch.correlation_id}).`
        );
      } else if (response.dispatch?.status === "queued_for_recovery") {
        setActionNotice(
          `Réconciliation enregistrée. La reprise automatique est activé (suivi ${response.dispatch.correlation_id}).`
        );
      }
      setReconcileState("idle");
      refetch();
    } catch (err) {
      setReconcileState("error");
      setActionError(
        isTakeoffApiError(err)
          ? err.message
          : "Impossible de relancer le reconcile de cette extraction."
      );
    }
  }, [jobId, refetch]);

  const handleResubmit = useCallback(async () => {
    setResubmitState("loading");
    setActionError(null);
    setActionNotice(null);
    try {
      const response = await resubmitTakeoffJob(jobId);
      if (response.dispatch?.status === "persistence_unconfirmed") {
        setActionNotice(
          `Nouvelle soumission créée, mais la reprise automatique n'a pas pu être confirmée. Réessayez (suivi ${response.dispatch.correlation_id}).`
        );
      } else if (response.dispatch?.status === "queued_for_recovery") {
        setActionNotice(
          `Nouvelle soumission enregistrée. La reprise automatique est activé (suivi ${response.dispatch.correlation_id}).`
        );
      }
      setResubmitState("idle");
      refetch();
    } catch (err) {
      setResubmitState("error");
      setActionError(
        isTakeoffApiError(err)
          ? err.message
          : "Impossible de resoumettre cette extraction."
      );
    }
  }, [jobId, refetch]);

  const handleCancel = useCallback(async () => {
    setCancelState("loading");
    setActionError(null);
    try {
      await cancelTakeoffJob(jobId);
      setCancelState("idle");
      refetch();
    } catch (err) {
      setCancelState("error");
      setActionError(
        isTakeoffApiError(err) ? err.message : "Impossible d’annuler cette extraction."
      );
    }
  }, [jobId, refetch]);

  const includedItemsCount = data?.items.data.filter((item) => !item.is_excluded).length ?? 0;
  const excludedItemsCount = (data?.items.data.length ?? 0) - includedItemsCount;

  const handleApplyWizardOpenChange = useCallback(
    (open: boolean) => {
      if (applyState === "loading") return;
      setIsApplyWizardOpen(open);
      if (open) {
        setApplyError(null);
      }
    },
    [applyState]
  );

  const handleApplyConfirm = useCallback(
    async (payload: TakeoffApplyWizardSubmitPayload) => {
      setApplyState("loading");
      setApplyError(null);
      let shouldReleaseDraftLock = false;

      try {
        const lockResult = await ensureTakeoffApplyDraftLock(versionId);
        if (!lockResult.acquired) {
          setApplyState("error");
          setApplyError(
            lockResult.errorMessage ??
              "Impossible d'acquerir le verrou de brouillon de la version cible."
          );
          return;
        }

        shouldReleaseDraftLock = lockResult.shouldRelease;

        const response = await applyTakeoffJob(jobId, {
          target_section_id: payload.targetSectionId,
          strategy: payload.strategy,
          overrides: payload.overrides.length > 0 ? payload.overrides : undefined,
          override: payload.override,
          override_justification: payload.overrideJustification,
        }, versionId);
        setApplyState("idle");
        setIsApplyWizardOpen(false);
        setApplySuccess({
          appliedAt: new Date().toISOString(),
          versionId,
          sectionLabel: payload.targetSectionLabel,
          strategy: payload.strategy,
          createdCount: response.summary.created_count,
          updatedCount: response.summary.updated_count,
          ignoredCount: response.summary.ignored_count,
        });
        refetch();
      } catch (err) {
        setApplyState("error");
        setApplyError(
          resolveErrorMessage(err, "Impossible d'appliquer les lignes extraites au devis.")
        );
      } finally {
        if (shouldReleaseDraftLock) {
          void releaseEstimateDraftLock(versionId).catch(() => false);
        }
      }
    },
    [jobId, refetch, versionId]
  );

  // Fatal error (no data ever loaded)
  if (!data && error && !isPolling) {
    return (
      <FatalError
        versionId={versionId}
        errorStatus={errorStatus}
        errorMessage={error}
      />
    );
  }

  // Loading skeleton
  if (!data) {
    return <SkeletonCard versionId={versionId} />;
  }

  const job = data.job;
  const status = job.status;
  const isActive = status === "pending" || status === "processing";
  const isCompleted = status === "completed";
  const canReconcile = job.can_reconcile ?? false;
  const canResubmit = job.can_resubmit ?? false;
  const canCancel = job.can_cancel ?? isActive;
  const canOpenApplyWizard = isCompleted && includedItemsCount > 0;

  return (
    <div className="animate-fade-in">
      <ProductionRibbon ariaLabel="Ruban métier des métrés">
        <ProductionRibbonHeader
          breadcrumbs={[
            { label: "Chiffrages", href: "/dashboard/estimates" },
            { label: "Métrés", href: `/dashboard/estimates/${versionId}/takeoff` },
            { label: "Extraction" },
          ]}
          title="Extraction"
          description={job.source_file_name ?? "Suivi du traitement"}
          actions={
            <>
              <span className={`status-badge ${getStatusCss(status)}`}>
                {isActive && <Spinner />}
                {getStatusLabel(status)}
              </span>
              {job.operator_state && job.operator_state !== "none" ? (
                <span
                  className={`status-badge status-inline ${
                    getOperatorStateBadgeVariant(job.operator_state) === "danger"
                      ? "status-canceled"
                      : getOperatorStateBadgeVariant(job.operator_state) === "warning"
                        ? "status-warning"
                        : "status-sent"
                  }`}
                >
                  {job.operator_state_label ?? job.operator_state}
                </span>
              ) : null}
              <Link
                href={`/dashboard/estimates/${versionId}/takeoff/new`}
                className={buttonVariants({ variant: "outline" })}
              >
                Nouvelle extraction
              </Link>
            </>
          }
        />
        <nav className="production-ribbon__tabs" aria-label="Navigation de l'extraction">
          <Link
            href={`/dashboard/estimates/${versionId}/takeoff`}
            className="production-ribbon__tab"
          >
            Extractions
          </Link>
          <span
            className="production-ribbon__tab"
            data-active="true"
            aria-current="page"
          >
            Détails
          </span>
          {isCompleted ? (
            <Link
              href={`/dashboard/estimates/${versionId}/takeoff/${jobId}/review`}
              className="production-ribbon__tab"
            >
              Revue
            </Link>
          ) : null}
        </nav>
      </ProductionRibbon>

      <Card className="p-4 sm:p-6">
        <JobDetailsGrid job={job} />
        <JobErrorSection job={job} />
        {(job.dispatch_status === "queued" ||
          job.dispatch_status === "trigger_failed") && (
          <div
            className="mt-4 rounded-md border border-warning-border bg-warning-light p-3"
            role="status"
          >
            <p className="text-sm font-medium text-foreground">
              Démarrage immédiat indisponible, reprise automatique active.
            </p>
            {job.dispatch_correlation_id ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Identifiant de suivi : {job.dispatch_correlation_id}
              </p>
            ) : null}
          </div>
        )}
      </Card>

      {actionError && (
        <Alert variant="danger" className="mt-4">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}
      {actionNotice && (
        <Alert variant="warning" className="mt-4">
          <AlertDescription className="text-foreground-secondary">{actionNotice}</AlertDescription>
        </Alert>
      )}
      {applySuccess && (
        <Alert variant="success" className="mt-4">
          <AlertTitle>Application au devis terminée.</AlertTitle>
          <AlertDescription className="mt-1 break-words text-xs text-muted-foreground">
            Version : {applySuccess.versionId} · Section : {applySuccess.sectionLabel} ·
            Stratégie : {getStrategyLabel(applySuccess.strategy)} · Créés :{" "}
            {applySuccess.createdCount} · Mis à jour : {applySuccess.updatedCount} · Ignorés :{" "}
            {applySuccess.ignoredCount} · {formatTimestamp(applySuccess.appliedAt)}
          </AlertDescription>
        </Alert>
      )}
      {!isApplyWizardOpen && applyError && (
        <Alert variant="danger" className="mt-4">
          <AlertDescription>{applyError}</AlertDescription>
        </Alert>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {isCompleted && (
          <Link
            href={`/dashboard/estimates/${versionId}`}
            className={buttonVariants({ variant: "primary" })}
          >
            Voir les résultats
          </Link>
        )}
        {isCompleted && (
          <Button
            variant="outline"
            disabled={!canOpenApplyWizard}
            loading={applyState === "loading"}
            onClick={() => handleApplyWizardOpenChange(true)}
          >
            Appliquer au devis
          </Button>
        )}
        {isCompleted && !canOpenApplyWizard && (
          <span className="self-center text-xs text-muted-foreground">
            Aucun item inclus à appliquer.
          </span>
        )}

        {canReconcile && (
          <Button
            variant="primary"
            loading={reconcileState === "loading"}
            onClick={handleReconcile}
          >
            Relancer reconcile
          </Button>
        )}

        {canResubmit ? (
          <Button
            variant="outline"
            loading={resubmitState === "loading"}
            onClick={handleResubmit}
          >
            Resoumettre
          </Button>
        ) : status === "failed" && job.can_resubmit === false ? (
          <span className="text-xs text-muted-foreground self-center">
            Aucune resoumission disponible pour ce job.
          </span>
        ) : null}

        {canCancel && (
          <Button
            variant="outline"
            loading={cancelState === "loading"}
            onClick={handleCancel}
          >
            Annuler l’extraction
          </Button>
        )}

        {!isCompleted && (
          <Link
            href={`/dashboard/estimates/${versionId}`}
            className={buttonVariants({ variant: "outline" })}
          >
            Retour au chiffrage
          </Link>
        )}
      </div>

      {isPolling && (
        <p className="mt-3 text-xs text-muted-foreground">
          Actualisation automatique en cours…
        </p>
      )}

      <TakeoffApplyWizard
        open={isApplyWizardOpen}
        jobId={jobId}
        versionId={versionId}
        targetVersionLabel={
          data?.job.version_number != null ? `V${data.job.version_number}` : null
        }
        includedCount={includedItemsCount}
        excludedCount={excludedItemsCount}
        isSubmitting={applyState === "loading"}
        submitError={applyError}
        onOpenChange={handleApplyWizardOpenChange}
        onConfirm={handleApplyConfirm}
        items={data?.items.data}
        jobLevel={data?.job.level ?? null}
        confidenceThreshold={lowConfidenceThreshold}
        isAdmin={isAdmin}
        reviewHref={`/dashboard/estimates/${versionId}/takeoff/${jobId}/review`}
      />
    </div>
  );
}
