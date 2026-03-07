"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { EstimateApprovalActions } from "@/components/estimates/EstimateApprovalActions";
import { EstimateApprovalDecisionJournalCard } from "@/components/estimates/EstimateApprovalDecisionJournalCard";
import { EstimateApprovalSummaryCard } from "@/components/estimates/EstimateApprovalSummaryCard";
import { RiskAlertBanner } from "@/components/direction/RiskAlertBanner";
import {
  createEstimateVariant,
  duplicateEstimateVersion,
} from "@/lib/estimates/client";
import type { DirectionSyntheticAlert } from "@/lib/direction/alerts";
import { formatEUR } from "@/lib/money";
import { useUiMode } from "@/hooks/useUiMode";
import type {
  AffaireHubDpgfSourceResult,
  AffaireHubMarginAnalysisResult,
  AffaireHubSummaryResult,
  AffaireHubTimelineResult,
} from "@/lib/affaires/server";
import type { EstimateApprovalDecisionJournal } from "@/lib/estimates/approval-decision-journal";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";
import type { ConfirmUnifiedImportFlowResult } from "@/app/dashboard/affaires/_actions/import-flow";

import { useToast } from "@/components/ui/Toast";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import type {
  AffaireRegisterPageResult,
  AffaireRegisterScopeOptions,
  AffaireRegisterSummary,
  AffaireRegisterTimelineEvent,
} from "@/lib/affaires/register";
import { AffaireStatusBadges } from "./AffaireStatusBadges";
import { AffaireRegisterCard } from "./AffaireRegisterCard";
import { BriefDraftCard } from "./BriefDraftCard";
import { IntakeWorkspace } from "./IntakeWorkspace";
import { LaunchMetreDialog } from "./LaunchMetreDialog";
import { MarginAnalysisWidget } from "./MarginAnalysisWidget";
import { PlansMetresCard } from "./PlansMetresCard";
import type { AffaireHubPlansSummaryData } from "./PlansMetresCard";
import {
  TakeoffLaunchPrompt,
  shouldShowTakeoffPrompt,
} from "@/components/takeoff/TakeoffLaunchPrompt";
import { useTakeoffAutoProposeDismissed } from "@/hooks/useTakeoffAutoProposeDismissed";
import { UnifiedImportFlow } from "./UnifiedImportFlow";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type AffaireHubProps = {
  summary: AffaireHubSummaryResult;
  timeline: AffaireHubTimelineResult | null;
  dpgfSource: AffaireHubDpgfSourceResult;
  marginAnalysis?: AffaireHubMarginAnalysisResult | null;
  approvalSummary?: EstimateApprovalSummary | null;
  approvalJournal?: EstimateApprovalDecisionJournal | null;
  directionSignals?: {
    latestJobId: string | null;
    alerts: DirectionSyntheticAlert[];
  };
  isReadOnlyReview?: boolean;
  plansSummary?: AffaireHubPlansSummaryData | null;
  takeoffEnabled?: boolean;
  sectionErrors?: {
    timeline?: string;
    dpgfSource?: string;
    marginAnalysis?: string;
    plansSummary?: string;
    register?: string;
  };
  justCreated?: boolean;
  intakeWorkspace?: AffaireIntakeWorkspace | null;
  registerPage?: AffaireRegisterPageResult | null;
  registerScopeOptions?: AffaireRegisterScopeOptions;
  registerSummary?: AffaireRegisterSummary | null;
  registerTimeline?: AffaireRegisterTimelineEvent[];
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
/*  Status helpers (reused from timeline conventions)                   */
/* ------------------------------------------------------------------ */

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoye",
  accepted: "Accepte",
  archived: "Archive",
};

const STATUS_CSS: Record<string, string> = {
  draft: "status-badge status-draft",
  sent: "status-badge status-sent",
  accepted: "status-badge status-accepted",
  archived: "status-badge status-archived",
};

// Prevent duplicate "created" toast when React remounts in development Strict Mode.
const shownCreatedToastProjectIds = new Set<string>();

/* ------------------------------------------------------------------ */
/*  Section: Back to list                                              */
/* ------------------------------------------------------------------ */

function BackToListLink() {
  return (
    <Link
      href="/dashboard/affaires"
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-[var(--slate-600)] transition-colors hover:bg-[var(--slate-100)] hover:text-[var(--slate-900)]"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
      Retour a la liste
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  Section: Action Bar (filled state)                                 */
/* ------------------------------------------------------------------ */

function ActionBar({
  summary,
  takeoffEnabled,
  plansSummary,
  pendingAction,
  onDuplicate,
  onCreateVariant,
  onLaunchMetre,
}: {
  summary: AffaireHubSummaryResult;
  takeoffEnabled?: boolean;
  plansSummary?: AffaireHubPlansSummaryData | null;
  pendingAction: "duplicate" | "variant" | null;
  onDuplicate: () => void;
  onCreateVariant: () => void;
  onLaunchMetre: () => void;
}) {
  const { currentVersion, versionsCount } = summary;
  if (!currentVersion) return null;

  return (
    <div className="action-bar animate-fade-in stagger-1">
      {/* Edit current version */}
      <Link
        href={`/dashboard/estimates/${currentVersion.id}/edit`}
        className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
        Editer V{currentVersion.versionNumber}
      </Link>

      {/* Export */}
      <Link
        href={`/dashboard/estimates/${currentVersion.id}/print`}
        className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" x2="12" y1="15" y2="3" />
        </svg>
        Exporter
      </Link>

      {/* New version (duplicate) */}
      <button
        type="button"
        onClick={onDuplicate}
        disabled={pendingAction !== null}
        aria-busy={pendingAction === "duplicate"}
        className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
        {pendingAction === "duplicate" ? "Duplication..." : "Nouvelle version"}
      </button>

      {/* Variant */}
      <button
        type="button"
        onClick={onCreateVariant}
        disabled={pendingAction !== null}
        aria-busy={pendingAction === "variant"}
        className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 3h5v5" />
          <path d="M8 3H3v5" />
          <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" />
          <path d="m15 9 6-6" />
        </svg>
        {pendingAction === "variant"
          ? "Creation variante..."
          : "Dupliquer (variante)"}
      </button>

      {/* Compare */}
      {versionsCount > 1 && (
        <Link
          href={`/dashboard/estimates/${currentVersion.id}/diff`}
          className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" x2="18" y1="20" y2="4" />
            <line x1="6" x2="6" y1="20" y2="4" />
            <line x1="2" x2="22" y1="12" y2="12" />
          </svg>
          Comparer
        </Link>
      )}

      {/* Launch metre */}
      {takeoffEnabled && plansSummary && plansSummary.planSetCount > 0 && (
        <button
          type="button"
          onClick={onLaunchMetre}
          className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 3v18" />
          </svg>
          Analyser les plans
        </button>
      )}
    </div>
  );
}

function FirstVersionActionBar({ projectId }: { projectId: string }) {
  return (
    <div className="action-bar animate-fade-in stagger-1">
      <Link
        href={`/dashboard/estimates/new?projectId=${projectId}`}
        className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" x2="12" y1="5" y2="19" />
          <line x1="5" x2="19" y1="12" y2="12" />
        </svg>
        Creer une premiere version
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section: Progress Strip (filled state)                             */
/* ------------------------------------------------------------------ */

function AffaireProgressStrip({
  summary,
  dpgfSource,
}: {
  summary: AffaireHubSummaryResult;
  dpgfSource: AffaireHubDpgfSourceResult;
}) {
  const { currentVersion, acceptedVersion } = summary;
  if (!currentVersion) return null;

  const items: { color: string; label: string }[] = [];

  // DPGF status
  if (dpgfSource !== null) {
    items.push({ color: "bg-[var(--success)]", label: "DPGF importe" });
  } else {
    items.push({ color: "bg-[var(--brand-orange)]", label: "Pas de DPGF" });
  }

  // Current version
  items.push({
    color: "bg-[var(--brand-blue)]",
    label: `V${currentVersion.versionNumber} courante - ${STATUS_LABEL[currentVersion.status] ?? currentVersion.status}`,
  });

  // Accepted version
  if (acceptedVersion) {
    items.push({
      color: "bg-[var(--success)]",
      label: `V${acceptedVersion.versionNumber} acceptee`,
    });
  } else {
    items.push({
      color: "bg-[var(--slate-300)]",
      label: "Aucune version acceptee",
    });
  }

  return (
    <div className="progress-strip animate-fade-in stagger-2">
      {items.map((item, i) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 text-[var(--slate-600)]">
          {i > 0 && <span className="text-[var(--slate-300)] mx-1">&middot;</span>}
          <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${item.color}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section: Financial Summary                                         */
/* ------------------------------------------------------------------ */

function FinancialSummaryCard({
  summary,
}: {
  summary: AffaireHubSummaryResult;
}) {
  const { currentVersion, acceptedVersion, lineCount } = summary;

  if (currentVersion === null) return null;

  const hasAccepted = !!acceptedVersion;

  return (
    <section className="dashboard-card p-5 animate-fade-in stagger-3">
      <h2 className="mb-4 text-sm font-semibold text-[var(--slate-800)]">
        Resume financier
      </h2>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--slate-500)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand-blue)]" />
            HT version courante
          </p>
          <p className="mt-1 text-2xl font-bold text-[var(--slate-900)]">
            {formatEUR(currentVersion.totalHtCents)}
          </p>
          <p className="mt-0.5 text-xs text-[var(--slate-500)]">
            V{currentVersion.versionNumber} -{" "}
            {STATUS_LABEL[currentVersion.status] ?? currentVersion.status}
          </p>
        </div>

        <div className={hasAccepted ? "rounded-lg bg-[var(--success)]/5 p-2 -m-2" : ""}>
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--slate-500)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
            HT derniere acceptee
          </p>
          {acceptedVersion ? (
            <>
              <p className="mt-1 text-2xl font-bold text-[var(--success)]">
                {formatEUR(acceptedVersion.totalHtCents)}
              </p>
              <p className="mt-0.5 text-xs text-[var(--slate-500)]">
                V{acceptedVersion.versionNumber}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-[var(--slate-400)]">-</p>
          )}
        </div>

        <div>
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--slate-500)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand-orange)]" />
            Marge appliquee
          </p>
          <p className="mt-1 text-2xl font-bold text-[var(--slate-900)]">
            {currentVersion.marginPercent.toFixed(1)}%
          </p>
          <p className="mt-0.5 text-xs text-[var(--slate-500)]">
            Coeff. {currentVersion.marginMultiplier.toFixed(3)}
          </p>
        </div>

        <div>
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--slate-500)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--slate-400)]" />
            Nombre de lignes
          </p>
          <p className="mt-1 text-2xl font-bold text-[var(--slate-900)]">
            {lineCount}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Section: Version Timeline                                          */
/* ------------------------------------------------------------------ */

function VersionTimelineCard({
  timeline,
  projectId,
  currentVersionId,
  acceptedVersionId,
  isReadOnlyReview,
  errorMessage,
}: {
  timeline: AffaireHubTimelineResult | null;
  projectId: string;
  currentVersionId: string | null;
  acceptedVersionId: string | null;
  isReadOnlyReview?: boolean;
  errorMessage?: string;
}) {
  if (timeline === null) {
    return (
      <section className="dashboard-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-[var(--slate-800)]">
          Versions
        </h2>
        <div className="rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/5 px-3 py-2 text-sm text-[var(--slate-700)]">
          {errorMessage ??
            "Impossible de charger la timeline des versions."}
        </div>
      </section>
    );
  }

  const { items, pagination } = timeline;

  return (
    <section className="dashboard-card p-5">
      <div className="mb-4 flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--slate-800)]">
          Versions
        </h2>
        <span className="rounded-full bg-[var(--slate-100)] px-2.5 py-0.5 text-xs font-medium text-[var(--slate-600)]">
          {pagination.total_count} version
          {pagination.total_count !== 1 ? "s" : ""}
        </span>
      </div>

      {items.length === 0 ? (
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
              <line x1="9" x2="15" y1="13" y2="13" />
              <line x1="9" x2="15" y1="17" y2="17" />
            </svg>
          }
          title="Aucune version encore"
          description="Creez une premiere version pour demarrer le chiffrage."
          actionLabel="Demarrer"
          actionHref={`/dashboard/estimates/new?projectId=${projectId}`}
          className="py-10"
        />
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div
            aria-hidden="true"
            className="absolute bottom-1 left-[11px] top-1 w-px bg-[var(--slate-200)]"
          />

          <ul className="space-y-3">
            {items.map((version) => {
              const isCurrent = version.id === currentVersionId;
              const isAccepted =
                version.id === acceptedVersionId &&
                version.status === "accepted";

              return (
                <li key={version.id} className="relative pl-8">
                  {/* Dot */}
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 top-5 h-3 w-3 rounded-full border-2 ${
                      isCurrent
                        ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]"
                        : isAccepted
                          ? "border-[var(--success)] bg-[var(--success)]"
                          : "border-[var(--slate-300)] bg-white"
                    }`}
                  />

                  <Link
                    href={
                      isReadOnlyReview
                        ? `/dashboard/estimates/${version.id}`
                        : `/dashboard/estimates/${version.id}/edit`
                    }
                    className={`block rounded-xl border px-3 py-3 transition-colors sm:px-4 ${
                      isCurrent
                        ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/5"
                        : "border-[var(--slate-200)] hover:bg-[var(--slate-50)]"
                    }`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-[var(--slate-800)]">
                            Version {version.version_number}
                          </p>
                          {isCurrent && (
                            <span className="status-badge status-confirmed">
                              Courante
                            </span>
                          )}
                          {isAccepted && (
                            <span className="status-badge status-accepted">
                              Derniere acceptee
                            </span>
                          )}
                        </div>
                        {version.title && (
                          <p
                            className="mt-0.5 truncate text-sm text-[var(--slate-600)]"
                            title={version.title}
                          >
                            {version.title}
                          </p>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--slate-500)]">
                          <span className={STATUS_CSS[version.status] ?? "status-badge status-draft"}>
                            {STATUS_LABEL[version.status] ?? version.status}
                          </span>
                          <span>
                            {fmtDate(version.created_at)}
                          </span>
                          {version.author_name && (
                            <span>Par {version.author_name}</span>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 text-left sm:text-right">
                        <p className="text-xs text-[var(--slate-500)]">
                          Total HT
                        </p>
                        <p className="text-sm font-semibold text-[var(--slate-800)]">
                          {formatEUR(version.total_ht_cents)}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Pagination */}
      {pagination.total_pages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--slate-200)] pt-4 text-xs text-[var(--slate-500)]">
          <span>
            Page {pagination.page}/{pagination.total_pages}
          </span>
          <div className="flex gap-2">
            {pagination.has_prev ? (
              <Link
                href={`/dashboard/affaires/${projectId}?timelinePage=${pagination.page - 1}`}
                className="btn btn-secondary btn-sm"
              >
                Prec.
              </Link>
            ) : (
              <span className="btn btn-secondary btn-sm opacity-50">
                Prec.
              </span>
            )}
            {pagination.has_next ? (
              <Link
                href={`/dashboard/affaires/${projectId}?timelinePage=${pagination.page + 1}`}
                className="btn btn-secondary btn-sm"
              >
                Suiv.
              </Link>
            ) : (
              <span className="btn btn-secondary btn-sm opacity-50">
                Suiv.
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Section: DPGF Source                                               */
/* ------------------------------------------------------------------ */

const IMPORT_STATUS_LABEL: Record<string, string> = {
  pending: "En attente",
  parsing: "En cours",
  completed: "Termine",
  failed: "Erreur",
};

const MAPPING_STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  validated: "Valide",
  applied: "Applique",
  archived: "Archive",
};

function DpgfSourceCard({
  dpgfSource,
  errorMessage,
  onStartImport,
}: {
  dpgfSource: AffaireHubDpgfSourceResult;
  errorMessage?: string;
  onStartImport?: () => void;
}) {
  return (
    <section className="dashboard-card p-5">
      <h2 className="mb-3 text-sm font-semibold text-[var(--slate-800)]">
        Source DPGF
      </h2>

      {errorMessage ? (
        <div className="rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/5 px-3 py-2 text-sm text-[var(--slate-700)]">
          {errorMessage}
        </div>
      ) : dpgfSource === null ? (
        <div className="py-4 text-center">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto mb-2 text-[var(--slate-300)]"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <p className="text-sm text-[var(--slate-500)]">
            Aucun import DPGF lie a cette affaire.
          </p>
          {onStartImport ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm mt-3 inline-flex"
              onClick={onStartImport}
            >
              Importer un DPGF
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className="truncate text-sm font-medium text-[var(--slate-800)]"
                title={dpgfSource.filename}
              >
                {dpgfSource.filename}
              </p>
              <p className="mt-0.5 text-xs text-[var(--slate-500)]">
                {dpgfSource.sourceFormat.toUpperCase()} &middot;{" "}
                {dpgfSource.rowCount} lignes &middot; Importe le{" "}
                {fmtDate(dpgfSource.importedAt)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge
              variant={
                dpgfSource.importStatus === "completed" ? "success" : "neutral"
              }
              size="sm"
            >
              Import:{" "}
              {IMPORT_STATUS_LABEL[dpgfSource.importStatus] ??
                dpgfSource.importStatus}
            </Badge>
            {dpgfSource.mappingStatus !== null && (
              <Badge
                variant={
                  dpgfSource.mappingStatus === "validated"
                    ? "success"
                    : "neutral"
                }
                size="sm"
              >
                Mapping:{" "}
                {MAPPING_STATUS_LABEL[dpgfSource.mappingStatus] ??
                  dpgfSource.mappingStatus}
              </Badge>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Main AffaireHub component                                          */
/* ------------------------------------------------------------------ */

export function AffaireHub({
  summary,
  timeline,
  dpgfSource,
  marginAnalysis,
  approvalSummary,
  approvalJournal,
  directionSignals,
  isReadOnlyReview = false,
  plansSummary,
  takeoffEnabled = false,
  sectionErrors,
  justCreated,
  intakeWorkspace,
  registerPage,
  registerScopeOptions,
  registerSummary,
  registerTimeline,
}: AffaireHubProps) {
  const router = useRouter();
  const toast = useToast();
  const { isExpert } = useUiMode();
  const currentVersionId = summary.currentVersion?.id ?? null;
  const acceptedVersionId = summary.acceptedVersion?.id ?? null;
  const [isEmptyPlansCardDismissed, setIsEmptyPlansCardDismissed] = useState(false);
  const [promptTemporarilyDismissed, setPromptTemporarilyDismissed] = useState(false);
  const {
    dismissed: promptPermanentlyDismissed,
    dismissPermanently: dismissPromptPermanently,
  } = useTakeoffAutoProposeDismissed(summary.project.id);

  // --- Hoisted state from former QuickActionsCard ---
  const [pendingAction, setPendingAction] = useState<"duplicate" | "variant" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleDuplicate = useCallback(async () => {
    if (!summary.currentVersion || pendingAction) return;
    setActionError(null);
    setPendingAction("duplicate");

    try {
      const duplicatedVersionId = await duplicateEstimateVersion(summary.currentVersion.id);
      router.push(`/dashboard/estimates/${duplicatedVersionId}/edit`);
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Impossible de dupliquer la version."
      );
    } finally {
      setPendingAction(null);
    }
  }, [summary.currentVersion, pendingAction, router]);

  const handleCreateVariant = useCallback(async () => {
    if (!summary.currentVersion || pendingAction) return;
    setActionError(null);
    setPendingAction("variant");

    try {
      const variantVersionId = await createEstimateVariant(summary.currentVersion.id);
      router.push(`/dashboard/estimates/${variantVersionId}/edit`);
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Impossible de creer la variante."
      );
    } finally {
      setPendingAction(null);
    }
  }, [summary.currentVersion, pendingAction, router]);

  useEffect(() => {
    if (!justCreated) return;

    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.has("created")) {
      currentUrl.searchParams.delete("created");
      const nextQuery = currentUrl.searchParams.toString();
      router.replace(nextQuery ? `${currentUrl.pathname}?${nextQuery}` : currentUrl.pathname, {
        scroll: false,
      });
    }

    const projectId = summary.project.id;
    if (shownCreatedToastProjectIds.has(projectId)) return;

    shownCreatedToastProjectIds.add(projectId);
    toast.success({
      title: "Affaire creee !",
      description: dpgfSource
        ? "DPGF lie — importez les lignes depuis l'editeur."
        : undefined,
    });
  }, [justCreated, router, summary.project.id, toast, dpgfSource]);

  useEffect(() => {
    setIsEmptyPlansCardDismissed(false);
    setPromptTemporarilyDismissed(false);
  }, [summary.project.id, plansSummary?.planSetCount]);

  const [showLaunchMetreDialog, setShowLaunchMetreDialog] = useState(false);

  // Bridge: command palette dispatches "open-analyse-plans" custom event
  useEffect(() => {
    const handler = () => setShowLaunchMetreDialog(true);
    document.addEventListener("open-analyse-plans", handler);
    return () => document.removeEventListener("open-analyse-plans", handler);
  }, []);
  const draftVersionId =
    summary.currentVersion?.status === "draft" ? summary.currentVersion.id : null;
  const hasAnyVersion = summary.versionsCount > 0;

  const showTakeoffPrompt =
    !isReadOnlyReview &&
    shouldShowTakeoffPrompt({
      takeoffEnabled,
      planSetCount: plansSummary?.planSetCount ?? 0,
      latestJob: plansSummary?.latestJob ?? null,
      draftVersionId,
      permanentlyDismissed: promptPermanentlyDismissed,
      temporarilyDismissed: promptTemporarilyDismissed,
    });

  const [showImportFlow, setShowImportFlow] = useState(false);
  const [importResult, setImportResult] =
    useState<ConfirmUnifiedImportFlowResult | null>(null);

  const handleImportComplete = useCallback(
    (result: ConfirmUnifiedImportFlowResult) => {
      setShowImportFlow(false);
      setImportResult(result);
      router.refresh();
    },
    [router],
  );

  return (
    <div className="animate-fade-in">
      {/* Back link */}
      <div className="mb-4">
        <BackToListLink />
      </div>

      {/* Read-only review banner for director */}
      {isReadOnlyReview && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/5 px-4 py-2.5 text-sm text-[var(--brand-blue)]">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span className="font-medium">Mode revue</span>
          <span className="text-[var(--brand-blue)]/70">
            — Consultation uniquement, les actions d&apos;edition sont reservees aux ingenieurs.
          </span>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="page-title truncate">{summary.project.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--slate-500)]">
            {summary.project.clientName && (
              <span>{summary.project.clientName}</span>
            )}
            {summary.project.reference && (
              <>
                {summary.project.clientName && (
                  <span className="text-[var(--slate-300)]">&middot;</span>
                )}
                <span>Ref. {summary.project.reference}</span>
              </>
            )}
          </div>
          {summary.currentVersion && (
            <div className="mt-2">
              <AffaireStatusBadges
                currentVersionNumber={summary.currentVersion.versionNumber}
                currentStatus={summary.currentVersion.status}
                acceptedVersionNumber={
                  summary.acceptedVersion?.versionNumber ?? null
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* Import result summary banner */}
      {importResult && (
        <div className="mb-4 animate-fade-in rounded-xl border border-[var(--success)]/20 bg-[var(--success)]/5 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--success)]/10">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--success)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--slate-800)]">
                  Import termine
                </p>
                <p className="mt-0.5 text-xs text-[var(--slate-600)]">
                  {importResult.stats.insertedRows} ligne
                  {importResult.stats.insertedRows > 1 ? "s" : ""} inseree
                  {importResult.stats.insertedRows > 1 ? "s" : ""}
                  {importResult.stats.skippedRows > 0 && (
                    <>
                      {" — "}
                      {importResult.stats.skippedRows} ignoree
                      {importResult.stats.skippedRows > 1 ? "s" : ""}
                    </>
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs text-[var(--slate-400)] hover:text-[var(--slate-600)]"
              onClick={() => setImportResult(null)}
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Intake workspace: document upload, classification triage, missing pieces */}
      {intakeWorkspace !== undefined && (
        <div className="mb-4">
          <IntakeWorkspace
            projectId={summary.project.id}
            workspace={intakeWorkspace}
          />
        </div>
      )}
      {intakeWorkspace !== undefined && (
        <div className="mb-4">
          <BriefDraftCard
            projectId={summary.project.id}
            briefDraft={intakeWorkspace?.briefDraft ?? null}
            isReadOnly={isReadOnlyReview}
          />
        </div>
      )}
      <div className="mb-4">
        <AffaireRegisterCard
          projectId={summary.project.id}
          versionId={summary.currentVersion?.id ?? null}
          registerPage={registerPage ?? null}
          scopeOptions={registerScopeOptions ?? { lots: [], lines: [] }}
          summary={registerSummary ?? null}
          timelineEvents={registerTimeline ?? []}
          isReadOnly={isReadOnlyReview}
          errorMessage={sectionErrors?.register}
        />
      </div>

      {/* Unified Import Flow (full-width, replaces grid when active) */}
      {showImportFlow ? (
        <UnifiedImportFlow
          projectId={summary.project.id}
          takeoffEnabled={takeoffEnabled}
          onCancel={() => setShowImportFlow(false)}
          onComplete={handleImportComplete}
        />
      ) : (
        <>
          {summary.versionsCount === 0 && !isReadOnlyReview ? (
            <FirstVersionActionBar projectId={summary.project.id} />
          ) : summary.versionsCount > 0 && !isReadOnlyReview ? (
            <ActionBar
              summary={summary}
              takeoffEnabled={takeoffEnabled}
              plansSummary={plansSummary}
              pendingAction={pendingAction}
              onDuplicate={() => void handleDuplicate()}
              onCreateVariant={() => void handleCreateVariant()}
              onLaunchMetre={() => setShowLaunchMetreDialog(true)}
            />
          ) : null}

          {actionError && (
            <div className="alert alert-error mb-4 px-3 py-2 text-xs">
              {actionError}
            </div>
          )}

          {showTakeoffPrompt && draftVersionId && plansSummary?.defaultPlanSetId && (
            <div className="mb-4 animate-fade-in">
              <TakeoffLaunchPrompt
                projectId={summary.project.id}
                versionId={draftVersionId}
                versionLabel={`V${summary.currentVersion!.versionNumber} (brouillon)`}
                planSetId={plansSummary.defaultPlanSetId}
                planFileCount={plansSummary.planFileCount}
                onLaunched={() => router.refresh()}
                onDismissTemporary={() => setPromptTemporarilyDismissed(true)}
                onDismissPermanent={dismissPromptPermanently}
              />
            </div>
          )}

          <AffaireProgressStrip summary={summary} dpgfSource={dpgfSource} />

          {directionSignals && directionSignals.alerts.length > 0 ? (
            <div className="mt-4">
              <RiskAlertBanner alerts={directionSignals.alerts} compact />
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <FinancialSummaryCard summary={summary} />
              {isExpert && (
                <MarginAnalysisWidget
                  data={marginAnalysis ?? null}
                  errorMessage={sectionErrors?.marginAnalysis}
                />
              )}
              <VersionTimelineCard
                timeline={timeline}
                projectId={summary.project.id}
                currentVersionId={currentVersionId}
                acceptedVersionId={acceptedVersionId}
                isReadOnlyReview={isReadOnlyReview}
                errorMessage={sectionErrors?.timeline}
              />
            </div>

            <div className="space-y-4">
              {approvalSummary ? (
                <EstimateApprovalSummaryCard summary={approvalSummary}>
                  {summary.currentVersion ? (
                    <EstimateApprovalActions
                      versionId={summary.currentVersion.id}
                      projectId={summary.project.id}
                      summary={approvalSummary}
                      submissionOverview={{
                        coveragePercent: plansSummary?.coveragePercent ?? null,
                        exceptionCount: plansSummary?.exceptionCount ?? null,
                        openQuestionsCount: plansSummary?.openQuestionsCount ?? null,
                        openAssumptionCount: registerSummary?.openAssumptionCount ?? null,
                        openMissingPieceCount: registerSummary?.openMissingPieceCount ?? null,
                        clarifyWithClientCount: registerSummary?.clarifyWithClientCount ?? null,
                        marginPercent: summary.currentVersion.marginPercent ?? null,
                      }}
                    />
                  ) : null}
                </EstimateApprovalSummaryCard>
              ) : null}
              {summary.currentVersion && approvalJournal ? (
                <EstimateApprovalDecisionJournalCard
                  versionId={summary.currentVersion.id}
                  initialJournal={approvalJournal}
                />
              ) : null}
              <DpgfSourceCard
                dpgfSource={dpgfSource}
                errorMessage={sectionErrors?.dpgfSource}
                onStartImport={
                  isReadOnlyReview
                    ? undefined
                    : () => {
                        setImportResult(null);
                        setShowImportFlow(true);
                      }
                }
              />
              {takeoffEnabled &&
              !(isEmptyPlansCardDismissed && (plansSummary?.planSetCount ?? 0) === 0) ? (
                <PlansMetresCard
                  plans={plansSummary ?? null}
                  projectId={summary.project.id}
                  errorMessage={sectionErrors?.plansSummary}
                  onLaunchMetre={
                    isReadOnlyReview ? undefined : () => setShowLaunchMetreDialog(true)
                  }
                  onDismissEmpty={
                    isReadOnlyReview
                      ? undefined
                      : () => {
                          setIsEmptyPlansCardDismissed(true);
                        }
                  }
                />
              ) : null}
            </div>
          </div>
        </>
      )}

      {!isReadOnlyReview ? (
        <LaunchMetreDialog
          open={showLaunchMetreDialog}
          onOpenChange={setShowLaunchMetreDialog}
          projectId={summary.project.id}
          draftVersionId={draftVersionId}
          hasAnyVersion={hasAnyVersion}
          plansSummary={plansSummary}
          versionLabel={
            summary.currentVersion
              ? `V${summary.currentVersion.versionNumber}${summary.currentVersion.status === "draft" ? " (brouillon)" : ""}`
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
