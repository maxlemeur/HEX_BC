"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { EstimateApprovalActions } from "@/components/estimates/EstimateApprovalActions";
import { EstimateApprovalDecisionJournalCard } from "@/components/estimates/EstimateApprovalDecisionJournalCard";
import { EstimateApprovalSummaryCard } from "@/components/estimates/EstimateApprovalSummaryCard";
import { RiskAlertBanner } from "@/components/direction/RiskAlertBanner";
import {
  createEstimateVariant,
  duplicateEstimateVersion,
  type VersionZeroDraftSummary,
} from "@/lib/estimates/client";
import type { DirectionSyntheticAlert } from "@/lib/direction/alerts";
import { formatEUR } from "@/lib/money";
import { useUiMode } from "@/hooks/useUiMode";
import type {
  AffaireHubDpgfSourceResult,
  AffaireHubFinishLineSummaryResult,
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
import { AffaireRegisterCard } from "./AffaireRegisterCard";
import { AffaireFlowHierarchyPanel } from "./AffaireFlowHierarchyPanel";
import { BriefDraftCard } from "./BriefDraftCard";
import { IntakeWorkspace } from "./IntakeWorkspace";
import { LaunchMetreDialog } from "./LaunchMetreDialog";
import { MarginAnalysisWidget } from "./MarginAnalysisWidget";
import { AffairePersistedProjectDetails } from "./AffairePersistedProjectDetails";
import { AffairePilotagePanel } from "./AffairePilotagePanel";
import { PlansMetresCard } from "./PlansMetresCard";
import type { AffaireHubPlansSummaryData } from "./PlansMetresCard";
import {
  shouldRenderPlansSection,
} from "./affaire-workflow";
import { AffaireCreatedOnboardingBanner } from "./AffaireCreatedOnboardingBanner";
import { AffaireWorkflowStepper } from "./AffaireWorkflowStepper";
import {
  TakeoffLaunchPrompt,
  shouldShowTakeoffPrompt,
} from "@/components/takeoff/TakeoffLaunchPrompt";
import { useTakeoffAutoProposeDismissed } from "@/hooks/useTakeoffAutoProposeDismissed";
import { UnifiedImportFlow } from "./UnifiedImportFlow";
import type { CockpitSuggestion } from "@/lib/cockpit/suggestions";
import { sortCockpitSuggestions } from "@/lib/cockpit/suggestions";
import type { CockpitSurfaceId } from "@/lib/cockpit/suggestions";
import { CockpitCommandBar } from "@/components/cockpit/CockpitCommandBar";
import { CockpitCommandPreview } from "@/components/cockpit/CockpitCommandPreview";
import {
  setCockpitSuggestions,
  clearCockpitSuggestions,
} from "@/lib/stores/cockpit-suggestions-store";
import {
  recordCockpitCommandAction,
  updateCockpitCommandPreferenceAction,
} from "@/app/dashboard/affaires/_actions/cockpit";
import { canLaunchNewTakeoffAnalysis } from "@/lib/takeoff/visible-status";
import {
  COCKPIT_EXECUTE_ACTION_EVENT,
  dispatchCockpitOpenSurface,
  type CockpitExecuteActionEventDetail,
} from "@/lib/cockpit/events";

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
  projectVersions?: Array<{
    id: string;
    versionNumber: number;
  }>;
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
  versionZeroSummary?: VersionZeroDraftSummary | null;
  finishLineSummary?: AffaireHubFinishLineSummaryResult | null;
  cockpitSuggestions?: CockpitSuggestion[];
  viewerProfileId?: string | null;
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
  sent: "Envoyé",
  accepted: "Accepté",
  archived: "Archivé",
};

const STATUS_CSS: Record<string, string> = {
  draft: "status-badge status-draft",
  sent: "status-badge status-sent",
  accepted: "status-badge status-accepted",
  archived: "status-badge status-archived",
};

// Prevent duplicate "created" toast when React remounts in development Strict Mode.
const shownCreatedToastProjectIds = new Set<string>();

function applyCockpitPreferenceUpdate(
  suggestions: CockpitSuggestion[],
  input: {
    actionId: string;
    isHidden?: boolean;
    isPinned?: boolean;
  },
) {
  return sortCockpitSuggestions(
    suggestions.map((suggestion) =>
      suggestion.actionId === input.actionId
        ? {
            ...suggestion,
            ...(typeof input.isHidden === "boolean"
              ? { isHidden: input.isHidden }
              : {}),
            ...(typeof input.isPinned === "boolean"
              ? { isPinned: input.isPinned }
              : {}),
          }
        : suggestion,
    ),
  );
}

function getCockpitPreferenceSnapshot(
  suggestions: CockpitSuggestion[],
  actionId: string,
): { isHidden: boolean; isPinned: boolean } | null {
  const suggestion = suggestions.find((candidate) => candidate.actionId === actionId);
  if (!suggestion) {
    return null;
  }

  return {
    isHidden: suggestion.isHidden,
    isPinned: suggestion.isPinned,
  };
}

function isSameCockpitPreference(
  left: { isHidden: boolean; isPinned: boolean } | null,
  right: { isHidden: boolean; isPinned: boolean } | null,
) {
  if (!left || !right) {
    return left === right;
  }

  return left.isHidden === right.isHidden && left.isPinned === right.isPinned;
}

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
      Retour à la liste
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  Section: Action Bar (filled state)                                 */
/* ------------------------------------------------------------------ */

function ActionBar({
  summary,
  versionZeroSummary,
  takeoffEnabled,
  plansSummary,
  pendingAction,
  onDuplicate,
  onCreateVariant,
  onLaunchMetre,
}: {
  summary: AffaireHubSummaryResult;
  versionZeroSummary?: VersionZeroDraftSummary | null;
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
        Éditer V{currentVersion.versionNumber}
      </Link>

      {currentVersion.status === "draft" &&
      (versionZeroSummary?.activeDraft || versionZeroSummary?.canGenerate) ? (
        <Link
          href={`/dashboard/estimates/${currentVersion.id}/edit?openVersionZero=1`}
          className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
        >
          {versionZeroSummary?.activeDraft ? "Revoir V0 IA" : "Générer V0"}
        </Link>
      ) : null}

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
          ? "Création variante..."
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
      {takeoffEnabled &&
      plansSummary &&
      plansSummary.planSetCount > 0 &&
      canLaunchNewTakeoffAnalysis(plansSummary.latestJob?.status) && (
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
        Créer une première version
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
    items.push({ color: "bg-[var(--success)]", label: "DPGF importé" });
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
      label: `V${acceptedVersion.versionNumber} acceptée`,
    });
  } else {
    items.push({
      color: "bg-[var(--slate-300)]",
      label: "Aucune version acceptée",
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

  const marginPct = currentVersion.marginPercent;
  const marginColorClass =
    marginPct >= 25
      ? "text-[var(--success)]"
      : marginPct >= 15
        ? "text-[var(--slate-900)]"
        : lineCount > 0
          ? "text-[var(--danger)]"
          : "text-[var(--slate-400)]";
  const isEmptyEstimate = currentVersion.totalHtCents === 0 && lineCount === 0;

  return (
    <section id="financial" className="dashboard-card p-5 animate-fade-in stagger-3 scroll-mt-24">
      <h2 className="mb-4 text-sm font-semibold text-[var(--slate-800)]">
        Résumé financier
      </h2>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--slate-500)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand-blue)]" />
            HT version courante
          </p>
          <p className={`mt-1 font-bold ${isEmptyEstimate ? "text-lg text-[var(--slate-400)]" : "text-2xl text-[var(--slate-900)]"}`}>
            {formatEUR(currentVersion.totalHtCents)}
          </p>
        </div>

        <div className={hasAccepted ? "rounded-lg bg-[var(--success)]/5 p-2 -m-2" : ""}>
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--slate-500)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
            HT dernière acceptée
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
            Marge appliquée
          </p>
          <p className={`mt-1 font-bold ${isEmptyEstimate ? "text-lg" : "text-2xl"} ${marginColorClass}`}>
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
          <p className={`mt-1 font-bold ${lineCount === 0 ? "text-lg text-[var(--slate-400)]" : "text-2xl text-[var(--slate-900)]"}`}>
            {lineCount}
          </p>
          {/* Duplicate "Éditer le devis" link removed: ActionBar "Éditer V1" serves same purpose */}
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
          description="Créez une première version pour démarrer le chiffrage."
          actionLabel="Démarrer"
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
                              Dernière acceptée
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
  completed: "Terminé",
  failed: "Erreur",
};

const MAPPING_STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  validated: "Validé",
  applied: "Appliqué",
  archived: "Archivé",
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
    <section id="dpgf" className="dashboard-card p-5 scroll-mt-24">
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
            Importez le bordereau de prix (DPGF) pour pré-remplir les lignes du devis.
          </p>
          {onStartImport ? (
            <button
              type="button"
              className="btn btn-primary btn-sm mt-3 inline-flex"
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
                {dpgfSource.rowCount} lignes &middot; Importé le{" "}
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
  projectVersions = [],
  sectionErrors,
  justCreated,
  intakeWorkspace,
  registerPage,
  registerScopeOptions,
  registerSummary,
  registerTimeline,
  versionZeroSummary,
  finishLineSummary,
  cockpitSuggestions,
  viewerProfileId,
}: AffaireHubProps) {
  const router = useRouter();
  const toast = useToast();
  const { isExpert } = useUiMode();
  const currentVersionId = summary.currentVersion?.id ?? null;
  const acceptedVersionId = summary.acceptedVersion?.id ?? null;
  const {
    dismissed: promptPermanentlyDismissed,
    temporarilyDismissed: promptTemporarilyDismissed,
    dismissPermanently: dismissPromptPermanently,
    dismissTemporarily: dismissPromptTemporarily,
    clearTemporaryDismissal: clearPromptTemporaryDismissal,
  } = useTakeoffAutoProposeDismissed(summary.project.id, {
    context: "hub",
    profileId: viewerProfileId ?? null,
    scopeKey: [
      plansSummary?.defaultPlanSetId ?? "none",
      summary.currentVersion?.status === "draft"
        ? summary.currentVersion.id
        : `current:${summary.currentVersion?.id ?? "none"}`,
      plansSummary?.defaultPlanSetUpdatedAt ?? "none",
    ].join(":"),
  });

  // --- Onboarding banner (post-creation guidance) ---
  const [showOnboardingBanner, setShowOnboardingBanner] = useState(false);

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
    const hasDossier = (intakeWorkspace?.documents?.length ?? 0) > 0;
    if (!hasDossier) {
      setShowOnboardingBanner(true);
    }
    toast.success({
      title: "Affaire créée !",
      description: dpgfSource
        ? "DPGF lié — importez les lignes depuis l'éditeur."
        : undefined,
    });
  }, [justCreated, router, summary.project.id, toast, dpgfSource, intakeWorkspace]);

  useEffect(() => {
    clearPromptTemporaryDismissal();
  }, [clearPromptTemporaryDismissal, summary.project.id, plansSummary?.planSetCount]);

  const [showLaunchMetreDialog, setShowLaunchMetreDialog] = useState(false);
  const [cockpitState, setCockpitState] = useState<CockpitSuggestion[]>(
    cockpitSuggestions ?? [],
  );
  const cockpitStateRef = useRef(cockpitSuggestions ?? []);
  const cockpitPreferenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const cockpitProjectIdRef = useRef(summary.project.id);
  const [previewSuggestion, setPreviewSuggestion] = useState<CockpitSuggestion | null>(null);
  const visibleCockpitSuggestions = useMemo(
    () => cockpitState.filter((suggestion) => !suggestion.isHidden),
    [cockpitState],
  );

  useEffect(() => {
    cockpitStateRef.current = cockpitState;
  }, [cockpitState]);

  useEffect(() => {
    cockpitStateRef.current = cockpitSuggestions ?? [];
    setCockpitState(cockpitSuggestions ?? []);
  }, [cockpitSuggestions]);

  useEffect(() => {
    cockpitPreferenceQueueRef.current = Promise.resolve();
    cockpitProjectIdRef.current = summary.project.id;
  }, [summary.project.id]);

  const openHubSurface = useCallback(
    (surfaceId: CockpitSurfaceId, actionId = "pilotage-panel") => {
      const sectionBySurface = {
        "intake-upload": "intake",
        "brief-confirm": "brief",
        "launch-metre": "plans",
        "approval-submit": "approval",
      } as const;

      const sectionId = sectionBySurface[surfaceId];
      document.getElementById(sectionId)?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });

      if (surfaceId === "launch-metre") {
        setShowLaunchMetreDialog(true);
        return;
      }

      dispatchCockpitOpenSurface({
        projectId: summary.project.id,
        actionId,
        surfaceId,
      });
    },
    [summary.project.id],
  );

  const handleOpenCockpitSurface = useCallback(
    (suggestion: CockpitSuggestion) => {
      if (suggestion.target.kind === "navigate") {
        router.push(suggestion.target.href);
        return;
      }

      openHubSurface(suggestion.target.surfaceId, suggestion.actionId);
    },
    [openHubSurface, router],
  );

  const commitCockpitExecution = useCallback(
    (suggestion: CockpitSuggestion) => {
      handleOpenCockpitSurface(suggestion);
      void Promise.resolve(
        recordCockpitCommandAction({
          projectId: summary.project.id,
          actionId: suggestion.actionId,
          intent: suggestion.intent,
        }),
      ).catch(() => {
        // Ignore tracking failures: the user action already ran.
      });
    },
    [handleOpenCockpitSurface, summary.project.id],
  );

  const handleExecuteCockpitSuggestion = useCallback(
    (suggestion: CockpitSuggestion) => {
      if (suggestion.requiresConfirmation) {
        setPreviewSuggestion(suggestion);
        return;
      }
      commitCockpitExecution(suggestion);
    },
    [commitCockpitExecution],
  );

  const handleToggleCockpitPreference = useCallback(
    (input: { actionId: string; isHidden?: boolean; isPinned?: boolean }) => {
      const projectId = summary.project.id;
      const previousState = cockpitStateRef.current;
      const previousPreference = getCockpitPreferenceSnapshot(
        previousState,
        input.actionId,
      );
      if (!previousPreference) {
        return;
      }

      const nextState = applyCockpitPreferenceUpdate(previousState, input);
      const nextPreference = getCockpitPreferenceSnapshot(nextState, input.actionId);
      if (!nextPreference || isSameCockpitPreference(previousPreference, nextPreference)) {
        return;
      }

      cockpitStateRef.current = nextState;
      setCockpitState(nextState);

      cockpitPreferenceQueueRef.current = cockpitPreferenceQueueRef.current.then(async () => {
        try {
          await updateCockpitCommandPreferenceAction({
            projectId,
            actionId: input.actionId,
            isHidden: nextPreference.isHidden,
            isPinned: nextPreference.isPinned,
          });
        } catch (error) {
          if (cockpitProjectIdRef.current !== projectId) {
            return;
          }

          const currentPreference = getCockpitPreferenceSnapshot(
            cockpitStateRef.current,
            input.actionId,
          );
          if (!isSameCockpitPreference(currentPreference, nextPreference)) {
            return;
          }

          const rolledBackState = applyCockpitPreferenceUpdate(cockpitStateRef.current, {
            actionId: input.actionId,
            isHidden: previousPreference.isHidden,
            isPinned: previousPreference.isPinned,
          });
          cockpitStateRef.current = rolledBackState;
          setCockpitState(rolledBackState);
          toast.error({
            title: "Préférence cockpit non enregistrée",
            description:
              error instanceof Error
                ? error.message
                : "Impossible de sauvegarder la préférence.",
          });
        }
      });
    },
    [summary.project.id, toast],
  );

  // Push cockpit suggestions to store for Ctrl+K bridge
  useEffect(() => {
    if (visibleCockpitSuggestions.length > 0) {
      setCockpitSuggestions({
        projectId: summary.project.id,
        suggestions: visibleCockpitSuggestions,
      });
      return () => clearCockpitSuggestions();
    }
    clearCockpitSuggestions();
    return () => clearCockpitSuggestions();
  }, [visibleCockpitSuggestions, summary.project.id]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<CockpitExecuteActionEventDetail>).detail;
      if (!detail || detail.projectId !== summary.project.id) {
        return;
      }
      handleExecuteCockpitSuggestion(detail.suggestion);
    };

    document.addEventListener(COCKPIT_EXECUTE_ACTION_EVENT, handler);
    return () => document.removeEventListener(COCKPIT_EXECUTE_ACTION_EVENT, handler);
  }, [handleExecuteCockpitSuggestion, summary.project.id]);
  const draftVersionId =
    summary.currentVersion?.status === "draft" ? summary.currentVersion.id : null;
  const takeoffPromptComparisonVersionId = summary.currentVersion?.id ?? null;
  const hasLaunchableVersionTarget = summary.currentVersion !== null;

  const showTakeoffPrompt =
    !isReadOnlyReview &&
    shouldShowTakeoffPrompt({
      takeoffEnabled,
      planFileCount: plansSummary?.defaultPlanSetFileCount ?? plansSummary?.planFileCount ?? 0,
      defaultPlanSetId: plansSummary?.defaultPlanSetId ?? null,
      defaultPlanSetUpdatedAt: plansSummary?.defaultPlanSetUpdatedAt ?? null,
      latestJob: plansSummary?.defaultPlanSetId
        ? plansSummary.defaultPlanSetLatestJob
          ? {
              status: plansSummary.defaultPlanSetLatestJob.status,
              planSetId: plansSummary.defaultPlanSetLatestJob.planSetId ?? null,
              estimateVersionId:
                plansSummary.defaultPlanSetLatestJob.estimateVersionId ?? null,
              createdAt: plansSummary.defaultPlanSetLatestJob.createdAt ?? "",
            }
          : null
        : plansSummary?.latestJob
          ? {
              status: plansSummary.latestJob.status,
              planSetId: plansSummary.latestJob.planSetId ?? null,
              estimateVersionId: plansSummary.latestJob.estimateVersionId ?? null,
              createdAt: plansSummary.latestJob.createdAt ?? "",
            }
          : null,
      targetVersionId: takeoffPromptComparisonVersionId,
      hasLaunchableVersionTarget,
      permanentlyDismissed: promptPermanentlyDismissed,
      temporarilyDismissed: promptTemporarilyDismissed,
    });

  // Extract earliest deadline from intake documents (Recommendation #5)
  const earliestDeadline = useMemo(() => {
    if (!intakeWorkspace?.documents?.length) return null;
    const deadlines = intakeWorkspace.documents
      .map((doc) => doc.extractedMetadata?.deadlineAt)
      .filter((d): d is string => d !== null && d !== undefined)
      .map((d) => new Date(d))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    return deadlines[0] ?? null;
  }, [intakeWorkspace]);

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
      {/* Breadcrumb (Recommendation #9) */}
      <nav aria-label="Fil d'Ariane" className="mb-4">
        <ol className="flex items-center gap-1.5 text-sm text-[var(--slate-500)]">
          <li>
            <BackToListLink />
          </li>
          <li aria-hidden="true" className="text-[var(--slate-300)]">/</li>
          <li className="truncate font-medium text-[var(--slate-700)]">
            {summary.project.name}
          </li>
        </ol>
      </nav>

      {/* Onboarding banner (post-creation, no dossier) */}
      {showOnboardingBanner && (intakeWorkspace?.documents?.length ?? 0) === 0 && (
        <AffaireCreatedOnboardingBanner
          onDismiss={() => setShowOnboardingBanner(false)}
          onScrollToIntake={() => {
            setShowOnboardingBanner(false);
            document.getElementById("intake")?.scrollIntoView({ behavior: "smooth" });
          }}
          onOpenImportFlow={() => {
            setShowOnboardingBanner(false);
            setShowImportFlow(true);
          }}
        />
      )}

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
            — Consultation uniquement, les actions d&apos;édition sont réservées aux ingénieurs.
          </span>
        </div>
      )}

      {/* Header with metadata (Recommendation #5) */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="page-title truncate">{summary.project.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--slate-500)]">
            {summary.project.clientName && (
              <span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1 inline-block align-[-2px]" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                {summary.project.clientName}
              </span>
            )}
            {summary.project.reference && (
              <>
                {summary.project.clientName && (
                  <span className="text-[var(--slate-300)]">&middot;</span>
                )}
                <span>Réf. {summary.project.reference}</span>
              </>
            )}
            {earliestDeadline && (
              <>
                <span className="text-[var(--slate-300)]">&middot;</span>
                <span className={`inline-flex items-center gap-1 ${
                  earliestDeadline.getTime() < Date.now()
                    ? "font-semibold text-[var(--danger)]"
                    : earliestDeadline.getTime() < Date.now() + 7 * 24 * 60 * 60 * 1000
                      ? "text-[var(--warning)]"
                      : ""
                }`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  Échéance {DATE_FMT.format(earliestDeadline)}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {!isReadOnlyReview && (
        <div className="mb-4">
          <AffairePersistedProjectDetails
            projectId={summary.project.id}
            initialValues={{
              projectName: summary.project.name,
              clientName: summary.project.clientName ?? "",
              reference: summary.project.reference ?? "",
            }}
          />
        </div>
      )}

      {/* Workflow stepper (Recommendation #1) */}
      <AffaireWorkflowStepper
        summary={summary}
        dpgfSource={dpgfSource}
        intakeWorkspace={intakeWorkspace}
        approvalSummary={approvalSummary}
        lineCount={summary.lineCount}
      />

      {/* Primary CTAs + Cockpit — merged into single visual block */}
      <div className="mb-2 space-y-0">
        {!showImportFlow && !isReadOnlyReview && (
          <>
            {summary.versionsCount === 0 ? (
              <FirstVersionActionBar projectId={summary.project.id} />
            ) : summary.versionsCount > 0 ? (
              <ActionBar
                summary={summary}
                versionZeroSummary={versionZeroSummary}
                takeoffEnabled={takeoffEnabled}
                plansSummary={plansSummary}
                pendingAction={pendingAction}
                onDuplicate={() => void handleDuplicate()}
                onCreateVariant={() => void handleCreateVariant()}
                onLaunchMetre={() => setShowLaunchMetreDialog(true)}
              />
            ) : null}
            {actionError && (
              <div className="alert alert-error px-3 py-2 text-xs">
                {actionError}
              </div>
            )}
          </>
        )}

        {/* Cockpit command bar */}
        {cockpitState.length > 0 && (
          <CockpitCommandBar
            suggestions={cockpitState}
            onExecute={handleExecuteCockpitSuggestion}
            onToggleHidden={(actionId, isHidden) => {
              handleToggleCockpitPreference({ actionId, isHidden });
            }}
            onTogglePinned={(actionId, isPinned) => {
              handleToggleCockpitPreference({ actionId, isPinned });
            }}
          />
        )}
        {previewSuggestion ? (
          <CockpitCommandPreview
            suggestion={previewSuggestion}
            onConfirm={() => {
              const suggestion = previewSuggestion;
              setPreviewSuggestion(null);
              if (suggestion) {
                commitCockpitExecution(suggestion);
              }
            }}
            onCancel={() => setPreviewSuggestion(null)}
          />
        ) : null}
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
                  Import terminé
                </p>
                <p className="mt-0.5 text-xs text-[var(--slate-600)]">
                  {importResult.stats.insertedRows} ligne
                  {importResult.stats.insertedRows > 1 ? "s" : ""} insérée
                  {importResult.stats.insertedRows > 1 ? "s" : ""}
                  {importResult.stats.skippedRows > 0 && (
                    <>
                      {" — "}
                      {importResult.stats.skippedRows} ignorée
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
          {showTakeoffPrompt &&
            plansSummary?.defaultPlanSetId &&
            plansSummary.launchRecommendation && (
            <div className="mb-4 animate-fade-in">
              <TakeoffLaunchPrompt
                projectId={summary.project.id}
                versionId={draftVersionId}
                versionLabel={
                  summary.currentVersion?.status === "draft"
                    ? `V${summary.currentVersion.versionNumber} (brouillon)`
                    : undefined
                }
                sourceVersionId={
                  summary.currentVersion?.status === "draft"
                    ? null
                    : summary.currentVersion?.id ?? null
                }
                sourceVersionLabel={
                  summary.currentVersion
                    ? `V${summary.currentVersion.versionNumber}`
                    : undefined
                }
                planSetId={plansSummary.defaultPlanSetId}
                planSetName={plansSummary.defaultPlanSetName ?? null}
                planFileCount={plansSummary.defaultPlanSetFileCount ?? plansSummary.planFileCount}
                launchRecommendation={plansSummary.launchRecommendation}
                onLaunched={() => router.refresh()}
                onDismissTemporary={dismissPromptTemporarily}
                onDismissPermanent={dismissPromptPermanently}
              />
            </div>
          )}

          <div className="mt-4">
            <AffaireFlowHierarchyPanel
              projectId={summary.project.id}
              currentVersion={summary.currentVersion ?? null}
              versionZeroSummary={versionZeroSummary}
              takeoffEnabled={takeoffEnabled}
              plansSummary={plansSummary ?? null}
            />
          </div>

          <div className="mt-4">
            <AffairePilotagePanel
              projectId={summary.project.id}
              projectName={summary.project.name}
              intakeWorkspace={intakeWorkspace ?? null}
              dpgfSource={dpgfSource}
              plansSummary={plansSummary ?? null}
              registerSummary={registerSummary ?? null}
              approvalSummary={approvalSummary ?? null}
              currentVersion={
                summary.currentVersion
                  ? {
                      id: summary.currentVersion.id,
                      status: summary.currentVersion.status,
                      versionNumber: summary.currentVersion.versionNumber,
                    }
                  : null
              }
              lineCount={summary.lineCount}
              finishLineSummary={finishLineSummary ?? null}
              takeoffEnabled={takeoffEnabled}
              onOpenSurface={
                isReadOnlyReview
                  ? undefined
                  : (surfaceId) => {
                      openHubSurface(surfaceId);
                    }
              }
            />
          </div>

          <AffaireProgressStrip summary={summary} dpgfSource={dpgfSource} />

          {directionSignals && directionSignals.alerts.length > 0 ? (
            <div className="mt-4">
              <RiskAlertBanner alerts={directionSignals.alerts} compact />
            </div>
          ) : null}

          {/* Two-column layout (Recommendation #3)
              Left: operational flow (intake, brief, financial, DPGF, timeline)
              Right: control (register, approval, journal, plans) */}
          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-5">
            <div className="space-y-4 lg:col-span-3">
              {/* Intake workspace: document upload, classification triage */}
              {intakeWorkspace !== undefined && (
                <div id="intake" className="scroll-mt-24">
                  <IntakeWorkspace
                    projectId={summary.project.id}
                    workspace={intakeWorkspace}
                    onBridgeDpgfImport={
                      isReadOnlyReview
                        ? undefined
                        : () => {
                            setImportResult(null);
                            setShowImportFlow(true);
                          }
                    }
                    dpgfAlreadyImported={dpgfSource !== null}
                    plansSynced={(plansSummary?.planSetCount ?? 0) > 0}
                  />
                </div>
              )}
              {intakeWorkspace !== undefined && (
                <div id="brief" className="scroll-mt-24">
                  <BriefDraftCard
                    projectId={summary.project.id}
                    briefDraft={intakeWorkspace?.briefDraft ?? null}
                    isReadOnly={isReadOnlyReview}
                  />
                </div>
              )}
              <FinancialSummaryCard summary={summary} />
              {isExpert && (
                <MarginAnalysisWidget
                  data={marginAnalysis ?? null}
                  errorMessage={sectionErrors?.marginAnalysis}
                />
              )}
              {(dpgfSource !== null || sectionErrors?.dpgfSource) && (
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

            <div className="space-y-4 lg:col-span-2">
              {/* Register: moved to sidebar (Recommendation #3) */}
              <div id="register" className="scroll-mt-24">
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
              {approvalSummary ? (
                <div id="approval" className="scroll-mt-24">
                  <EstimateApprovalSummaryCard summary={approvalSummary}>
                  {summary.currentVersion ? (
                    <EstimateApprovalActions
                      versionId={summary.currentVersion.id}
                      projectId={summary.project.id}
                      summary={approvalSummary}
                      isEmpty={summary.lineCount === 0}
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
                </div>
              ) : null}
              {summary.currentVersion && approvalJournal ? (
                <EstimateApprovalDecisionJournalCard
                  versionId={summary.currentVersion.id}
                  initialJournal={approvalJournal}
                />
              ) : null}
              {/* Plans: moved up in sidebar (Recommendation #23) */}
              {shouldRenderPlansSection({
                takeoffEnabled,
                planSetCount: plansSummary?.planSetCount,
                plansErrorMessage: sectionErrors?.plansSummary,
              }) ? (
                <div id="plans" className="scroll-mt-24">
                  <PlansMetresCard
                    plans={plansSummary ?? null}
                    projectId={summary.project.id}
                    errorMessage={sectionErrors?.plansSummary}
                    onLaunchMetre={
                      isReadOnlyReview ? undefined : () => setShowLaunchMetreDialog(true)
                    }
                  />
                </div>
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
          currentVersion={
            summary.currentVersion
              ? {
                  id: summary.currentVersion.id,
                  status: summary.currentVersion.status,
                  versionNumber: summary.currentVersion.versionNumber,
                }
              : null
          }
          plansContext={plansSummary ?? null}
          availableVersions={projectVersions}
        />
      ) : null}
    </div>
  );
}
