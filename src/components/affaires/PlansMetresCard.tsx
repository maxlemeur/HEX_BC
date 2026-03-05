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
    id: string;
    status: string;
    level: string;
    source_file_name: string | null;
    items_count: number;
    created_at: string;
  } | null;
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

const JOB_STATUS_BADGE: Record<string, { variant: BadgeVariant; label: string }> = {
  pending: { variant: "neutral", label: "En attente" },
  processing: { variant: "info", label: "En cours" },
  completed: { variant: "success", label: "Termine" },
  failed: { variant: "error", label: "Echoue" },
  canceled: { variant: "neutral", label: "Annule" },
  applied: { variant: "success", label: "Applique" },
};

/* ------------------------------------------------------------------ */
/*  Date formatter                                                     */
/* ------------------------------------------------------------------ */

const DATE_FMT = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : DATE_FMT.format(d);
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
          Plans & Metres
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
          Plans & Metres
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
          title="Ajoutez vos plans"
          description="Importez vos plans PDF pour lancer des metres automatiques."
          actionLabel="Importer des plans"
          actionHref={`/dashboard/affaires/${projectId}/plans`}
          className="py-10"
        />
      </section>
    );
  }

  /* Data state */
  const { latestJob } = plans;
  const jobBadge = latestJob
    ? JOB_STATUS_BADGE[latestJob.status] ?? { variant: "neutral" as BadgeVariant, label: latestJob.status }
    : null;

  return (
    <section className="dashboard-card p-5">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--slate-800)]">
          Plans & Metres
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
      {latestJob && jobBadge && (
        <div className="mt-3 rounded-lg border border-[var(--slate-200)] px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={jobBadge.variant} size="sm">
              {jobBadge.label}
            </Badge>
            <span className="text-xs text-[var(--slate-500)]">
              {latestJob.items_count} elements extraits
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            {fmtDate(latestJob.created_at)}
            {latestJob.source_file_name && (
              <> &middot; {latestJob.source_file_name}</>
            )}
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/dashboard/affaires/${projectId}/plans`}
          className="btn btn-secondary btn-sm inline-flex"
        >
          Voir les plans
        </Link>
        <Link
          href={`/dashboard/affaires/${projectId}/takeoff`}
          className="btn btn-secondary btn-sm inline-flex"
        >
          Voir les extractions
        </Link>
        <button
          type="button"
          disabled={!onLaunchMetre}
          onClick={onLaunchMetre}
          className={`btn btn-secondary btn-sm inline-flex${!onLaunchMetre ? " opacity-50" : ""}`}
        >
          Lancer un metre
        </button>
      </div>
    </section>
  );
}
