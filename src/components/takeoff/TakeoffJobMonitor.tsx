"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  cancelTakeoffJob as cancelTakeoffJobApi,
  isTakeoffApiError,
  retryTakeoffJob as retryTakeoffJobApi,
} from "@/lib/takeoff/client";
import { useTakeoffJobPolling } from "@/lib/takeoff/use-takeoff-job-polling";
import {
  TAKEOFF_JOB_MAX_RETRY_COUNT,
  type TakeoffJobSummary,
} from "@/lib/takeoff/types";

type TakeoffJobMonitorProps = {
  jobId: string;
  versionId: string;
};

type ActionState = "idle" | "loading" | "error";

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

function getStatusCss(status: string) {
  return STATUS_CSS_MAP[status] ?? "status-draft";
}

function getStatusLabel(status: string) {
  return STATUS_LABEL_MAP[status] ?? status;
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
    <svg
      className="inline-block h-4 w-4 animate-spin text-[var(--info)]"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Job Takeoff</h1>
          <p className="page-description">Chargement...</p>
        </div>
      </div>
      <section className="dashboard-card p-6">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-4 animate-pulse rounded bg-[var(--slate-200)]"
              style={{ width: `${60 + (i % 3) * 15}%` }}
            />
          ))}
        </div>
      </section>
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
      ? "Job introuvable"
      : errorStatus === 403
        ? "Acces refuse"
        : "Erreur";
  const message =
    errorMessage ?? "Une erreur est survenue lors du chargement du job.";

  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-description">{message}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href={`/dashboard/estimates/${versionId}`}
          className="btn btn-secondary btn-sm"
        >
          Retour au chiffrage
        </Link>
        <Link
          href={`/dashboard/estimates/${versionId}/takeoff/new`}
          className="btn btn-primary btn-sm"
        >
          Nouveau job
        </Link>
      </div>
    </div>
  );
}

function JobDetailsGrid({ job }: { job: TakeoffJobSummary }) {
  const isProcessing = job.status === "processing";
  const hasDuration = job.metrics.duration_ms !== null;

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <dt className="text-xs font-medium text-[var(--slate-500)]">Fichier</dt>
        <dd className="mt-1 text-sm">
          {job.source_file_name ?? "-"}
          {job.source_file_type && (
            <span className="ml-1 text-xs text-[var(--slate-500)]">
              ({job.source_file_type})
            </span>
          )}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-[var(--slate-500)]">Taille</dt>
        <dd className="mt-1 text-sm">
          {formatFileSize(job.source_file_size_bytes)}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-[var(--slate-500)]">Niveau</dt>
        <dd className="mt-1 text-sm">{job.level}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-[var(--slate-500)]">ID Job</dt>
        <dd className="mt-1 font-mono text-xs">{job.id}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-[var(--slate-500)]">
          Cree le
        </dt>
        <dd className="mt-1 text-sm">{formatTimestamp(job.created_at)}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-[var(--slate-500)]">
          Demarre le
        </dt>
        <dd className="mt-1 text-sm">{formatTimestamp(job.started_at)}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-[var(--slate-500)]">
          Termine le
        </dt>
        <dd className="mt-1 text-sm">{formatTimestamp(job.completed_at)}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-[var(--slate-500)]">Duree</dt>
        <dd className="mt-1 text-sm">
          {isProcessing && !hasDuration ? (
            <LiveDuration startedAt={job.started_at} />
          ) : (
            formatDurationMs(job.metrics.duration_ms)
          )}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-[var(--slate-500)]">
          Relances
        </dt>
        <dd className="mt-1 text-sm">
          {job.retry_count} / {TAKEOFF_JOB_MAX_RETRY_COUNT}
        </dd>
      </div>
      {job.metrics.token_count !== null && (
        <div>
          <dt className="text-xs font-medium text-[var(--slate-500)]">
            Tokens
          </dt>
          <dd className="mt-1 text-sm">
            {job.metrics.token_count.toLocaleString("fr-FR")}
          </dd>
        </div>
      )}
      {job.metrics.cost_cents !== null && (
        <div>
          <dt className="text-xs font-medium text-[var(--slate-500)]">Cout</dt>
          <dd className="mt-1 text-sm">
            {formatCostCents(job.metrics.cost_cents)}
          </dd>
        </div>
      )}
    </div>
  );
}

function JobErrorSection({ job }: { job: TakeoffJobSummary }) {
  if (!job.error_code && !job.error_message) return null;

  return (
    <div className="mt-4 rounded-md border border-[var(--error)] bg-[var(--error-light)] p-4">
      <p className="text-sm font-medium text-[var(--error)]">
        {job.error_code && (
          <span className="mr-2 font-mono text-xs">[{job.error_code}]</span>
        )}
        {job.error_message ?? "Une erreur est survenue."}
      </p>
    </div>
  );
}

export default function TakeoffJobMonitor({
  jobId,
  versionId,
}: TakeoffJobMonitorProps) {
  const { data, error, errorStatus, isPolling, refetch } =
    useTakeoffJobPolling(jobId);

  const [retryState, setRetryState] = useState<ActionState>("idle");
  const [cancelState, setCancelState] = useState<ActionState>("idle");
  const [actionError, setActionError] = useState<string | null>(null);

  const handleRetry = useCallback(async () => {
    setRetryState("loading");
    setActionError(null);
    try {
      await retryTakeoffJobApi(jobId);
      setRetryState("idle");
      refetch();
    } catch (err) {
      setRetryState("error");
      setActionError(
        isTakeoffApiError(err)
          ? err.message
          : "Impossible de relancer le job."
      );
    }
  }, [jobId, refetch]);

  const handleCancel = useCallback(async () => {
    setCancelState("loading");
    setActionError(null);
    try {
      await cancelTakeoffJobApi(jobId);
      setCancelState("idle");
      refetch();
    } catch (err) {
      setCancelState("error");
      setActionError(
        isTakeoffApiError(err)
          ? err.message
          : "Impossible d'annuler le job."
      );
    }
  }, [jobId, refetch]);

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
    return <SkeletonCard />;
  }

  const job = data.job;
  const status = job.status;
  const isActive = status === "pending" || status === "processing";
  const isFailed = status === "failed";
  const isCompleted = status === "completed";
  const canRetry = isFailed && job.retry_count < TAKEOFF_JOB_MAX_RETRY_COUNT;
  const canCancel = isActive;

  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="page-title">Job Takeoff</h1>
          <span className={`status-badge ${getStatusCss(status)}`}>
            {isActive && <Spinner />}
            {getStatusLabel(status)}
          </span>
        </div>
        <Link
          href={`/dashboard/estimates/${versionId}/takeoff/new`}
          className="btn btn-secondary btn-sm"
        >
          Nouveau job
        </Link>
      </div>

      <section className="dashboard-card p-6">
        <dl>
          <JobDetailsGrid job={job} />
        </dl>
        <JobErrorSection job={job} />
      </section>

      {actionError && (
        <div className="mt-4 rounded-md border border-[var(--error)] bg-[var(--error-light)] p-3">
          <p className="text-sm text-[var(--error)]">{actionError}</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {isCompleted && (
          <Link
            href={`/dashboard/estimates/${versionId}/takeoff/${jobId}/review`}
            className="btn btn-primary btn-sm"
          >
            Voir les resultats
          </Link>
        )}

        {canRetry && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={retryState === "loading"}
            onClick={handleRetry}
          >
            {retryState === "loading" ? "Relance..." : "Relancer"}
          </button>
        )}

        {isFailed && !canRetry && (
          <span className="text-xs text-[var(--slate-500)] self-center">
            Nombre maximal de relances atteint
          </span>
        )}

        {canCancel && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={cancelState === "loading"}
            onClick={handleCancel}
          >
            {cancelState === "loading" ? "Annulation..." : "Annuler"}
          </button>
        )}

        <Link
          href={`/dashboard/estimates/${versionId}`}
          className="btn btn-secondary btn-sm"
        >
          Retour au chiffrage
        </Link>
      </div>

      {isPolling && (
        <p className="mt-3 text-xs text-[var(--slate-500)]">
          Actualisation automatique en cours...
        </p>
      )}
    </div>
  );
}
