"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/Badge";
import type { BadgeProps } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatFileSize } from "@/components/takeoff/PlanFileCard";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type AffaireHubPlansSummaryData = {
  planSetCount: number;
  planFileCount: number;
  totalSizeBytes: number;
  latestJob: {
    jobId: string;
    status: "running" | "done" | "failed" | "review_required";
    label: string;
    estimateVersionId: string;
  } | null;
  coveragePercent: number;
  exceptionCount: number;
  openQuestionsCount: number;
  failureReasonLabel: string | null;
};

type PlansMetresCardProps = {
  plans: AffaireHubPlansSummaryData | null;
  projectId: string;
  errorMessage?: string;
  onLaunchMetre?: () => void;
};

/* ------------------------------------------------------------------ */
/*  Badge status mapping                                               */
/* ------------------------------------------------------------------ */

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

const FE_STATUS_BADGE: Record<string, BadgeVariant> = {
  running: "info",
  done: "success",
  review_required: "warning",
  failed: "error",
};

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

function WarningIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="inline-block shrink-0"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function QuestionIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="inline-block shrink-0"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PlansMetresCard({
  plans,
  projectId,
  errorMessage,
  onLaunchMetre,
}: PlansMetresCardProps) {
  /* Error state */
  if (errorMessage) {
    return (
      <section className="dashboard-card p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--slate-800)]">
          Plans, preuves & exceptions
        </h2>
        <div className="rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/5 px-3 py-2 text-sm text-[var(--slate-700)]">
          {errorMessage}
        </div>
      </section>
    );
  }

  /* Empty state */
  if (!plans || plans.planSetCount === 0) {
    return (
      <section className="dashboard-card p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--slate-800)]">
          Plans, preuves & exceptions
        </h2>
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
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18" />
              <path d="M9 3v18" />
            </svg>
          }
          title="Importez vos plans pour lancer l'analyse"
          description="Les plans PDF permettent d'extraire automatiquement les metres, de les comparer au DPGF et de detecter les ecarts."
          actionLabel="Ajouter les plans"
          actionHref={`/dashboard/affaires/${projectId}/plans`}
          className="py-10"
        />
      </section>
    );
  }

  /* Data state */
  const { latestJob } = plans;
  const badgeVariant = latestJob
    ? FE_STATUS_BADGE[latestJob.status] ?? ("neutral" as BadgeVariant)
    : null;

  const showSummary =
    latestJob &&
    (latestJob.status === "done" || latestJob.status === "review_required");

  const summarySegments: string[] = [];
  if (showSummary) {
    if (plans.coveragePercent > 0) {
      summarySegments.push(`${plans.coveragePercent} % des postes couverts`);
    }
    if (plans.exceptionCount > 0) {
      summarySegments.push(
        `${plans.exceptionCount} ecart${plans.exceptionCount !== 1 ? "s" : ""} majeur${plans.exceptionCount !== 1 ? "s" : ""}`
      );
    }
    if (plans.openQuestionsCount > 0) {
      summarySegments.push(
        `${plans.openQuestionsCount} question${plans.openQuestionsCount !== 1 ? "s" : ""} ouverte${plans.openQuestionsCount !== 1 ? "s" : ""}`
      );
    }
  }

  return (
    <section className="dashboard-card p-5">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--slate-800)]">
          Plans, preuves & exceptions
        </h2>
        <span className="rounded-full bg-[var(--slate-100)] px-2.5 py-0.5 text-xs font-medium text-[var(--slate-600)]">
          {plans.planSetCount} jeu{plans.planSetCount !== 1 ? "x" : ""}
        </span>
      </div>

      {/* Stats */}
      <p className="text-sm text-[var(--slate-600)]">
        {plans.planFileCount} fichier{plans.planFileCount !== 1 ? "s" : ""}{" "}
        &middot; {formatFileSize(plans.totalSizeBytes)}
      </p>

      {/* Latest job */}
      {latestJob && badgeVariant && (
        <div className="mt-3 rounded-lg border border-[var(--slate-200)] px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={badgeVariant} size="sm">
              {latestJob.label}
            </Badge>
          </div>
          {latestJob.status === "failed" && plans.failureReasonLabel && (
            <p className="mt-1 text-xs text-[var(--slate-500)]">
              {plans.failureReasonLabel}
            </p>
          )}
        </div>
      )}

      {/* Business summary */}
      {showSummary && summarySegments.length > 0 && (
        <p
          className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--slate-600)]"
          aria-live="polite"
        >
          {plans.exceptionCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[var(--warning)]">
              <WarningIcon />
            </span>
          )}
          {plans.openQuestionsCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[var(--slate-500)]">
              <QuestionIcon />
            </span>
          )}
          <span>{summarySegments.join(" — ")}</span>
        </p>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/dashboard/affaires/${projectId}/plans`}
          className="btn btn-secondary btn-sm inline-flex"
        >
          Voir les plans
        </Link>
        {latestJob &&
          (latestJob.status === "done" ||
            latestJob.status === "review_required") && (
            <Link
              href={`/dashboard/affaires/${projectId}/takeoff/${latestJob.jobId}/review?versionId=${latestJob.estimateVersionId}&view=dpgf&dpgfView=exceptions_only`}
              className="btn btn-secondary btn-sm inline-flex"
            >
              Voir les exceptions
            </Link>
          )}
        <button
          type="button"
          disabled={!onLaunchMetre}
          onClick={onLaunchMetre}
          className={`btn btn-secondary btn-sm inline-flex${!onLaunchMetre ? " opacity-50" : ""}`}
        >
          Analyser les plans
        </button>
      </div>
    </section>
  );
}
