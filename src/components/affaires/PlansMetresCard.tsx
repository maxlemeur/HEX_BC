"use client";

import Link from "next/link";
import useSWR from "swr";

import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatFileSize } from "@/components/takeoff/PlanFileCard";
import { fetchTakeoffActivityCenter } from "@/lib/takeoff/client";
import {
  buildTakeoffContinuitySnapshot,
  type TakeoffContinuitySnapshot,
} from "@/lib/takeoff/continuity";
import type { TakeoffDocumentRecommendation } from "@/lib/takeoff/document-classifier";
import type { TakeoffActivityCenterJobRow } from "@/lib/takeoff/types";
import {
  canLaunchNewTakeoffAnalysis,
  isTakeoffVisibleJobInFlight,
  type TakeoffVisibleJobStatus,
} from "@/lib/takeoff/visible-status";
import { CircleHelpIcon, PanelsTopLeftIcon, TriangleAlertIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type AffaireHubPlansSummaryData = {
  planSetCount: number;
  planFileCount: number;
  totalSizeBytes: number;
  hasLegacyFallback?: boolean;
  defaultPlanSetId: string | null;
  defaultPlanSetName?: string | null;
  defaultPlanSetSource?: string | null;
  defaultPlanSetFileCount?: number;
  defaultPlanSetUpdatedAt?: string | null;
  launchRecommendation?: TakeoffDocumentRecommendation | null;
  defaultPlanSetLatestJob?: {
    status: string;
    planSetId?: string | null;
    estimateVersionId?: string | null;
    createdAt?: string;
  } | null;
  latestJob: {
    jobId: string;
    status: TakeoffVisibleJobStatus;
    label: string;
    reviewVersionId: string;
    planSetId?: string | null;
    estimateVersionId?: string;
    createdAt?: string;
  } | null;
  coveragePercent: number | null;
  exceptionCount: number | null;
  openQuestionsCount: number;
  failureReasonLabel: string | null;
};

type PlansMetresCardProps = {
  plans: AffaireHubPlansSummaryData | null;
  projectId: string;
  errorMessage?: string;
  onLaunchMetre?: () => void;
  hideLaunchAction?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Badge status mapping                                               */
/* ------------------------------------------------------------------ */

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

const FE_STATUS_BADGE: Record<string, BadgeVariant> = {
  queued: "info",
  processing: "info",
  provider_pending: "info",
  completed: "success",
  review_required: "warning",
  action_required: "danger",
};

const TAKEOFF_CONTINUITY_PAGE_SIZE = 50;
const CONTINUITY_WAITING_STATUSES = new Set([
  "queued",
  "processing",
  "provider_pending",
]);

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

function WarningIcon() {
  return (
    <TriangleAlertIcon aria-hidden="true" className="inline-block shrink-0" size={14} />
  );
}

function QuestionIcon() {
  return (
    <CircleHelpIcon aria-hidden="true" className="inline-block shrink-0" size={14} />
  );
}

function isIntakeSyncedPlanSet(source: string | null | undefined) {
  return source === "affaire-intake";
}

function getPlanSetContextCopy(input: {
  source: string | null | undefined;
  fileCount: number;
}) {
  if (isIntakeSyncedPlanSet(input.source)) {
    return {
      badge: "Synchronise depuis le dossier",
      summary: `${input.fileCount} plan${input.fileCount > 1 ? "s" : ""} confirme${input.fileCount > 1 ? "s" : ""} repris depuis l'intake affaire.`,
      detail: "Aucun reupload n'est nécessaire pour lancer le métré sur ces plans.",
    };
  }

  return {
    badge: null,
    summary: `${input.fileCount} plan${input.fileCount > 1 ? "s" : ""} disponible${input.fileCount > 1 ? "s" : ""} pour le métré.`,
    detail: "Vérifiez le jeu de plans retenu avant de lancer l'analyse.",
  };
}

async function fetchTakeoffContinuityJobs(
  projectId: string,
  planSetId: string | null
): Promise<TakeoffActivityCenterJobRow[]> {
  const jobs: TakeoffActivityCenterJobRow[] = [];
  let nextOffset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (nextOffset < total) {
    const response = await fetchTakeoffActivityCenter(projectId, {
      planSetId,
      limit: TAKEOFF_CONTINUITY_PAGE_SIZE,
      offset: nextOffset,
    });

    jobs.push(...response.jobs);
    total = response.pagination.total;

    if (response.jobs.length === 0) {
      break;
    }

    nextOffset += response.jobs.length;
  }

  return jobs;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PlansMetresCard({
  plans,
  projectId,
  errorMessage,
  onLaunchMetre,
  hideLaunchAction = false,
}: PlansMetresCardProps) {
  const continuityPlanSetId =
    plans?.latestJob !== null && plans?.latestJob !== undefined
      ? (plans.latestJob.planSetId ?? plans.defaultPlanSetId ?? null)
      : (plans?.defaultPlanSetId ?? null);
  const latestJobId = plans?.latestJob?.jobId ?? null;
  const hasPlans = (plans?.planSetCount ?? 0) > 0;
  const { data: continuityJobs } = useSWR(
    hasPlans ? ["plans-metres-continuity", projectId, continuityPlanSetId] : null,
    () => fetchTakeoffContinuityJobs(projectId, continuityPlanSetId),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
    }
  );
  const continuitySnapshot: TakeoffContinuitySnapshot | null = continuityJobs
    ? buildTakeoffContinuitySnapshot({
        jobs: continuityJobs,
        latestJobId,
      })
    : null;
  const continuityActionLabel =
    continuitySnapshot?.latestStatusRaw === "action_required"
      ? "Reprendre l'analyse"
      : continuitySnapshot &&
          CONTINUITY_WAITING_STATUSES.has(continuitySnapshot.latestStatusRaw)
        ? "Suivre la reprise"
        : null;

  /* Error state */
  if (errorMessage) {
    return (
      <section className="rounded-lg border border-border bg-surface shadow-card p-5">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Plans, preuves & exceptions
        </h2>
        <Alert variant="warning">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      </section>
    );
  }

  /* Empty state */
  if (!plans || plans.planSetCount === 0) {
    return (
      <section className="rounded-lg border border-border bg-surface shadow-card p-5">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Plans, preuves & exceptions
        </h2>
        <div className="animate-fade-in flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-subtle/70 px-6 py-10 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface text-subtle-foreground shadow-sm ring-1 ring-border">
            <PanelsTopLeftIcon strokeWidth="1.5" aria-hidden="true" size={26} />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            Importez vos plans pour lancer l&apos;analyse
          </h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Les plans PDF permettent d&apos;extraire automatiquement les métrés, de les comparer au DPGF et de détecter les écarts.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <Link
              href={`/dashboard/affaires/${projectId}/plans`}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              Ajouter les plans
            </Link>
          </div>
        </div>
      </section>
    );
  }

  /* Data state */
  const { latestJob } = plans;
  const planSetContext = getPlanSetContextCopy({
    source: plans.defaultPlanSetSource,
    fileCount: plans.defaultPlanSetFileCount ?? plans.planFileCount,
  });
  const badgeVariant = latestJob
    ? FE_STATUS_BADGE[latestJob.status] ?? ("neutral" as BadgeVariant)
    : null;

  const isCompletedState =
    latestJob !== null &&
    (latestJob.status === "completed" || latestJob.status === "review_required");
  const canReview =
    latestJob !== null &&
    (latestJob.status === "completed" || latestJob.status === "review_required");
  const needsAction = latestJob?.status === "action_required";
  const isQueuedOrProcessing = isTakeoffVisibleJobInFlight(latestJob?.status);
  const canLaunchNewAnalysis = canLaunchNewTakeoffAnalysis(latestJob?.status);

  const coverageAvailable =
    plans.coveragePercent !== null && plans.exceptionCount !== null;

  const { coveragePercent, exceptionCount } = plans;
  const summarySegments: string[] = [];
  if (plans.openQuestionsCount > 0) {
    summarySegments.push(
      `${plans.openQuestionsCount} point${plans.openQuestionsCount !== 1 ? "s" : ""} registre ouvert${plans.openQuestionsCount !== 1 ? "s" : ""}`
    );
  }
  if (isCompletedState && coveragePercent !== null && exceptionCount !== null) {
    if (coveragePercent > 0) {
      summarySegments.push(`${coveragePercent} % des postes couverts`);
    }
    if (exceptionCount > 0) {
      summarySegments.push(
        `${exceptionCount} écart${exceptionCount !== 1 ? "s" : ""} majeur${exceptionCount !== 1 ? "s" : ""}`
      );
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface shadow-card p-5">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Plans, preuves & exceptions
        </h2>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {plans.planSetCount} jeu{plans.planSetCount !== 1 ? "x" : ""}
        </span>
      </div>

      {/* Stats */}
      <p className="text-sm text-muted-foreground">
        {plans.planFileCount} fichier{plans.planFileCount !== 1 ? "s" : ""}{" "}
        &middot; {formatFileSize(plans.totalSizeBytes)}
      </p>

      <div className="mt-3 rounded-lg border border-border bg-surface-subtle/70 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {planSetContext.badge ? (
            <Badge variant="info">
              {planSetContext.badge}
            </Badge>
          ) : null}
          <p className="text-sm font-medium text-foreground">
            {planSetContext.summary}
          </p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {planSetContext.detail}
        </p>
      </div>

      {/* Latest job */}
      {latestJob && badgeVariant && (
        <div className="mt-3 rounded-lg border border-border px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={badgeVariant}>
              {latestJob.label}
            </Badge>
          </div>
          {needsAction && plans.failureReasonLabel && (
            <p className="mt-1 text-xs text-muted-foreground">
              {plans.failureReasonLabel}
            </p>
          )}
        </div>
      )}

      {continuitySnapshot && (
        <div className="mt-3 rounded-lg border border-border bg-surface-subtle/70 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">
              {continuitySnapshot.title}
            </p>
          </div>

          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {continuitySnapshot.description}
          </p>

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Badge variant="success">
              {continuitySnapshot.acquiredCount} acquis
            </Badge>
            <Badge variant="info">
              {continuitySnapshot.waitingCount} en attente
            </Badge>
            <Badge variant="warning">
              {continuitySnapshot.actionRequiredCount} à corriger
            </Badge>
          </div>

          <ol className="mt-3 space-y-2">
            {continuitySnapshot.history.map((entry) => (
              <li
                key={entry.jobId}
                className="rounded-lg border border-border bg-surface px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle-foreground">
                    {entry.versionLabel}
                  </span>
                  <span className="text-sm text-foreground-secondary">
                    {entry.statusLabel}
                  </span>
                </div>
                {entry.carriedOverFrom ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Carry-over depuis {entry.carriedOverFrom}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>

          {continuityActionLabel ? (
            <div className="mt-3">
              <Link
                href={`/dashboard/affaires/${projectId}/takeoff`}
                className={cn(buttonVariants({ variant: "outline", size: "md" }))}
              >
                {continuityActionLabel}
              </Link>
            </div>
          ) : null}
        </div>
      )}

      {/* Business summary */}
      {isCompletedState && !coverageAvailable && summarySegments.length === 0 && (
        <p
          className="mt-2 text-xs text-muted-foreground italic"
          aria-live="polite"
        >
          Couverture indisponible
        </p>
      )}
      {summarySegments.length > 0 && (
        <p
          className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {exceptionCount !== null && exceptionCount > 0 && (
            <span className="inline-flex items-center gap-1 text-warning">
              <WarningIcon />
            </span>
          )}
          {plans.openQuestionsCount > 0 && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
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
          className={cn(buttonVariants({ variant: "outline", size: "md" }))}
        >
          Voir les plans
        </Link>
        {canReview ? (
          <Link
            href={`/dashboard/affaires/${projectId}/takeoff/${latestJob.jobId}/review?versionId=${latestJob.reviewVersionId}&view=dpgf&dpgfView=exceptions_only`}
            className={cn(buttonVariants({ variant: "outline", size: "md" }))}
          >
            Revoir l&apos;analyse
          </Link>
        ) : null}
        {plans.openQuestionsCount > 0 ? (
          <Link
            href={`/dashboard/affaires/${projectId}`}
            className={cn(buttonVariants({ variant: "outline", size: "md" }))}
          >
            Ouvrir le registre
          </Link>
        ) : null}
        {needsAction && !hideLaunchAction ? (
          <>
            <button
              type="button"
              disabled={!onLaunchMetre}
              onClick={onLaunchMetre}
              className={cn(buttonVariants({ variant: "outline", size: "md" }))}
            >
              Relancer l&apos;analyse
            </button>
            <button
              type="button"
              disabled={!onLaunchMetre}
              onClick={onLaunchMetre}
              className={cn(buttonVariants({ variant: "outline", size: "md" }))}
            >
              Changer de niveau
            </button>
            <Link
              href={`/dashboard/affaires/${projectId}/plans`}
              className={cn(buttonVariants({ variant: "outline", size: "md" }))}
            >
              Vérifier les plans
            </Link>
          </>
        ) : null}
        {isQueuedOrProcessing ? (
          <Link
            href={`/dashboard/affaires/${projectId}/takeoff`}
            className={cn(buttonVariants({ variant: "outline", size: "md" }))}
          >
            Suivre l&apos;analyse
          </Link>
        ) : null}
        {canLaunchNewAnalysis && !hideLaunchAction ? (
          <button
            type="button"
            disabled={!onLaunchMetre}
            onClick={onLaunchMetre}
            className={cn(buttonVariants({ variant: "outline", size: "md" }))}
          >
            Analyser les plans
          </button>
        ) : null}
      </div>
    </section>
  );
}
