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
import type { CockpitIntent, CockpitSuggestion } from "@/lib/cockpit/suggestions";
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

export function shouldShowAffaireCreatedOnboardingBanner(input: {
  showOnboardingBanner: boolean;
  intakeWorkspace: Pick<AffaireIntakeWorkspace, "documents"> | null | undefined;
  dpgfSource: AffaireHubDpgfSourceResult;
}) {
  return (
    input.showOnboardingBanner &&
    (input.intakeWorkspace?.documents?.length ?? 0) === 0 &&
    !input.dpgfSource
  );
}

export function isAffaireFreshStartState(input: {
  intakeWorkspace: Pick<AffaireIntakeWorkspace, "documents"> | null | undefined;
  dpgfSource: AffaireHubDpgfSourceResult;
  lineCount: number;
}) {
  return (
    (input.intakeWorkspace?.documents?.length ?? 0) === 0 &&
    !input.dpgfSource &&
    input.lineCount === 0
  );
}

export function getEstimateMarginSettingsHref(versionId: string) {
  return `/dashboard/estimates/${versionId}/edit?openSettings=margin`;
}

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

function findCockpitIntent(
  suggestions: CockpitSuggestion[],
  intent: CockpitIntent,
) {
  return suggestions.find((suggestion) => !suggestion.isHidden && suggestion.intent === intent) ?? null;
}

function findCockpitAction(
  suggestions: CockpitSuggestion[],
  actionId: string,
) {
  return suggestions.find(
    (suggestion) => !suggestion.isHidden && suggestion.actionId === actionId,
  ) ?? null;
}

export function getAffaireHubDominantIntent(suggestions: CockpitSuggestion[]) {
  if (findCockpitIntent(suggestions, "review_intake")) {
    return "review_intake" as const;
  }

  if (findCockpitAction(suggestions, "review-revalidation")) {
    return "list_hypotheses" as const;
  }

  if (findCockpitIntent(suggestions, "add_missing_pieces")) {
    return "add_missing_pieces" as const;
  }

  if (findCockpitIntent(suggestions, "confirm_brief")) {
    return "confirm_brief" as const;
  }

  if (findCockpitIntent(suggestions, "continue_hybrid")) {
    return "continue_hybrid" as const;
  }

  if (findCockpitIntent(suggestions, "analyze_plans")) {
    return "analyze_plans" as const;
  }

  if (findCockpitIntent(suggestions, "generate_structure")) {
    return "generate_structure" as const;
  }

  if (findCockpitAction(suggestions, "list-clarifications")) {
    return "list_hypotheses" as const;
  }

  return null;
}

export function filterAffaireHubCommandBarSuggestions(
  suggestions: CockpitSuggestion[],
  dominantIntent: CockpitIntent | null,
) {
  if (!dominantIntent) {
    return suggestions;
  }

  const suppressedIntentsByDominant: Partial<Record<CockpitIntent, CockpitIntent[]>> = {
    review_intake: [
      "add_missing_pieces",
      "confirm_brief",
      "continue_hybrid",
      "generate_structure",
      "analyze_plans",
    ],
    add_missing_pieces: ["confirm_brief", "continue_hybrid", "generate_structure", "analyze_plans"],
    confirm_brief: ["continue_hybrid", "generate_structure", "analyze_plans"],
    continue_hybrid: ["generate_structure", "analyze_plans"],
    generate_structure: ["continue_hybrid", "analyze_plans"],
    analyze_plans: ["continue_hybrid", "generate_structure"],
    list_hypotheses: [
      "add_missing_pieces",
      "confirm_brief",
      "continue_hybrid",
      "generate_structure",
      "analyze_plans",
      "prepare_validation",
    ],
  };
  const suppressedIntents = new Set(suppressedIntentsByDominant[dominantIntent] ?? []);
  const hasRegisterDominantAction =
    dominantIntent === "list_hypotheses" &&
    (findCockpitAction(suggestions, "review-revalidation") ||
      findCockpitAction(suggestions, "list-clarifications"));

  return suggestions.filter((suggestion) => {
    if (suggestion.intent === dominantIntent) {
      return false;
    }

    if (suggestion.intent === "add_files") {
      return false;
    }

    if (suppressedIntents.has(suggestion.intent)) {
      return false;
    }

    if (hasRegisterDominantAction && suggestion.intent === "list_hypotheses") {
      return false;
    }

    return true;
  });
}

export function getAffaireHubIntakeWorkspacePresentation(input: {
  dominantIntent: CockpitIntent | null;
  isReadOnlyReview?: boolean;
}) {
  return {
    hideAddFilesAction: input.dominantIntent === "add_missing_pieces",
    hideMissingPiecesAction: input.dominantIntent === "add_missing_pieces",
    showBridgeDpgfImport: !input.isReadOnlyReview,
  };
}

function isReadyLinkedDpgfSource(
  dpgfSource: AffaireHubDpgfSourceResult,
) {
  return Boolean(
    dpgfSource &&
      dpgfSource.importStatus === "completed" &&
      (dpgfSource.mappingStatus === null ||
        dpgfSource.mappingStatus === "validated" ||
        dpgfSource.mappingStatus === "applied") &&
      dpgfSource.mappedRowCount > 0,
  );
}

export function shouldPreferLinkedDpgfImportAction(input: {
  summary: AffaireHubSummaryResult;
  dpgfSource: AffaireHubDpgfSourceResult;
}) {
  return Boolean(
    input.summary.currentVersion?.status === "draft" &&
      input.summary.lineCount === 0 &&
      (input.summary.structureMode?.mode === "not_started" ||
        input.summary.structureMode == null) &&
      isReadyLinkedDpgfSource(input.dpgfSource),
  );
}

export function filterAffaireHubCommandBarSuggestionsForLinkedDpgf(
  suggestions: CockpitSuggestion[],
  preferLinkedDpgfImportAction: boolean,
) {
  if (!preferLinkedDpgfImportAction) {
    return suggestions;
  }

  return suggestions.filter(
    (suggestion) =>
      suggestion.intent !== "generate_structure" &&
      suggestion.intent !== "continue_hybrid" &&
      suggestion.intent !== "analyze_plans",
  );
}

/* ------------------------------------------------------------------ */
/*  Section: Back to list                                              */
/* ------------------------------------------------------------------ */

function BackToListLink() {
  return (
    <Link
      href="/dashboard/affaires"
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-[var(--slate-600)] transition-colors hover:bg-[var(--slate-100)] hover:text-[var(--slate-900)] sm:min-h-0"
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
      <span className="sm:hidden">Affaires</span>
      <span className="hidden sm:inline">Retour à la liste</span>
    </Link>
  );
}

export function getAffaireHubHiddenPilotageExceptionIds(input: {
  dominantIntent: CockpitIntent | null;
  hasDominantClarificationSuggestion: boolean;
  hasDominantRevalidationSuggestion: boolean;
}) {
  if (input.dominantIntent === "review_intake") {
    return ["intake-review"];
  }
  if (input.dominantIntent === "add_missing_pieces") {
    return ["missing-pieces"];
  }
  if (input.dominantIntent === "confirm_brief") {
    return ["brief-confirm"];
  }
  if (
    input.dominantIntent === "continue_hybrid" ||
    input.dominantIntent === "analyze_plans"
  ) {
    return ["takeoff-launch"];
  }
  if (input.dominantIntent === "list_hypotheses") {
    if (input.hasDominantClarificationSuggestion) {
      return ["register-clarify", "register-open", "takeoff-launch"];
    }
    if (input.hasDominantRevalidationSuggestion) {
      return ["register-revalidation", "register-open", "takeoff-launch"];
    }
  }

  return [];
}

export function shouldHideAffaireHubTakeoffLaunchAction(input: {
  dominantIntent: CockpitIntent | null;
  hasDominantClarificationSuggestion: boolean;
  hasDominantRevalidationSuggestion: boolean;
}) {
  return (
    input.dominantIntent === "continue_hybrid" ||
    input.dominantIntent === "analyze_plans" ||
    input.hasDominantClarificationSuggestion ||
    input.hasDominantRevalidationSuggestion
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
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    function handleClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [moreOpen]);

  if (!currentVersion) return null;

  const showCompare = versionsCount > 1;
  const showAnalyse =
    takeoffEnabled &&
    plansSummary &&
    plansSummary.planSetCount > 0 &&
    canLaunchNewTakeoffAnalysis(plansSummary.latestJob?.status);
  const hasSecondaryActions = showCompare || showAnalyse || true; // always has duplicate + variant

  return (
    <div className="action-bar animate-fade-in stagger-1 max-sm:!grid max-sm:grid-cols-3 max-sm:gap-2 lg:flex-nowrap lg:justify-end">
      {takeoffEnabled ? (
        <Link
          href={`/dashboard/affaires/${summary.project.id}/takeoff`}
          className="btn btn-primary btn-sm col-span-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 sm:w-auto"
        >
          Ouvrir les métrés
        </Link>
      ) : null}

      {/* Edit current version */}
      <Link
        href={`/dashboard/estimates/${currentVersion.id}/edit`}
        className={`btn btn-sm inline-flex min-h-11 items-center justify-center gap-1.5 max-sm:w-full max-sm:gap-1 max-sm:whitespace-nowrap max-sm:px-2 max-sm:text-xs ${
          takeoffEnabled ? "btn-secondary" : "btn-primary"
        }`}
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

      {/* V0 IA — contextual */}
      {currentVersion.status === "draft" &&
      (versionZeroSummary?.activeDraft || versionZeroSummary?.canGenerate) ? (
        <Link
          href={`/dashboard/estimates/${currentVersion.id}/edit?openVersionZero=1`}
          className="btn btn-secondary btn-sm col-span-3 inline-flex min-h-11 items-center justify-center gap-1.5"
        >
          {versionZeroSummary?.activeDraft ? "Revoir V0 IA" : "Générer V0"}
        </Link>
      ) : null}

      {/* Export — frequent */}
      <Link
        href={`/dashboard/estimates/${currentVersion.id}/print`}
        className="btn btn-secondary btn-sm inline-flex min-h-11 items-center justify-center gap-1.5 max-sm:w-full max-sm:gap-1 max-sm:whitespace-nowrap max-sm:px-2 max-sm:text-xs"
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

      {/* "Plus" dropdown — secondary actions */}
      {hasSecondaryActions && (
        <div className="relative max-sm:w-full" ref={moreRef}>
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className="btn btn-secondary btn-sm inline-flex min-h-11 items-center justify-center gap-1 max-sm:w-full max-sm:whitespace-nowrap max-sm:px-2 max-sm:text-xs"
            aria-haspopup="true"
            aria-expanded={moreOpen}
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
              <circle cx="12" cy="12" r="1" />
              <circle cx="19" cy="12" r="1" />
              <circle cx="5" cy="12" r="1" />
            </svg>
            Plus
          </button>
          {moreOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-[min(200px,calc(100vw-2rem))] rounded-lg border border-[var(--slate-200)] bg-white py-1 shadow-lg">
              {/* New version */}
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  onDuplicate();
                }}
                disabled={pendingAction !== null}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--slate-700)] hover:bg-[var(--slate-50)] disabled:opacity-50"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
                {pendingAction === "duplicate" ? "Duplication..." : "Nouvelle version"}
              </button>

              {/* Variant */}
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  onCreateVariant();
                }}
                disabled={pendingAction !== null}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--slate-700)] hover:bg-[var(--slate-50)] disabled:opacity-50"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 3h5v5" />
                  <path d="M8 3H3v5" />
                  <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" />
                  <path d="m15 9 6-6" />
                </svg>
                {pendingAction === "variant" ? "Création variante..." : "Dupliquer (variante)"}
              </button>

              {/* Compare */}
              {showCompare && (
                <Link
                  href={`/dashboard/estimates/${currentVersion.id}/diff`}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--slate-700)] hover:bg-[var(--slate-50)]"
                  onClick={() => setMoreOpen(false)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" x2="18" y1="20" y2="4" />
                    <line x1="6" x2="6" y1="20" y2="4" />
                    <line x1="2" x2="22" y1="12" y2="12" />
                  </svg>
                  Comparer
                </Link>
              )}

              {/* Analyse plans */}
              {showAnalyse && (
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    onLaunchMetre();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--slate-700)] hover:bg-[var(--slate-50)]"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M3 9h18" />
                    <path d="M9 3v18" />
                  </svg>
                  Analyser les plans
                </button>
              )}
            </div>
          )}
        </div>
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
        Creer un premier devis manuel
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

  if (summary.structureMode) {
    const structureModeLabel =
      summary.structureMode.mode === "manual"
        ? "Structure manuelle"
        : summary.structureMode.mode === "imported"
          ? "Structure importee"
          : summary.structureMode.mode === "hybrid"
            ? "Mode hybride"
            : summary.structureMode.mode === "needs_update"
              ? "Structure a remettre a jour"
              : null;

    if (structureModeLabel) {
      items.push({
        color:
          summary.structureMode.mode === "needs_update"
            ? "bg-[var(--brand-orange)]"
            : "bg-[var(--brand-blue)]",
        label: structureModeLabel,
      });
    }
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
  canEditMargin,
}: {
  summary: AffaireHubSummaryResult;
  canEditMargin: boolean;
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
          {canEditMargin ? (
            <Link
              href={getEstimateMarginSettingsHref(currentVersion.id)}
              className="mt-2 inline-flex min-h-9 items-center rounded-md px-2 text-xs font-semibold text-[var(--brand-blue)] transition-colors hover:bg-[var(--brand-blue)]/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2"
              title="Ouvrir les paramètres de marge du devis"
            >
              Modifier la marge
            </Link>
          ) : null}

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

export function DpgfSourceCard({
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
            Importez le bordereau de prix (DPGF) comme base pour pre-remplir la structure du devis.
          </p>
          {onStartImport ? (
            <button
              type="button"
              className="btn btn-primary btn-sm mt-3 inline-flex"
              onClick={onStartImport}
            >
              Importer la DPGF
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
          {onStartImport ? (
            <div className="flex flex-col gap-3 border-t border-[var(--slate-200)] pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-[var(--slate-500)]">
                Relancez le mapping depuis l&apos;Excel. Le devis reste inchangé
                jusqu&apos;à la confirmation.
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm shrink-0"
                onClick={onStartImport}
              >
                Reprendre l&apos;import
              </button>
            </div>
          ) : null}
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

  // --- Project details edit mode (controlled from breadcrumb) ---
  const [editingProject, setEditingProject] = useState(false);
  const [actionsPortalTarget, setActionsPortalTarget] = useState<HTMLDivElement | null>(null);

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
        error instanceof Error ? error.message : "Impossible de créer la variante."
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
    if (
      shouldShowAffaireCreatedOnboardingBanner({
        showOnboardingBanner: true,
        intakeWorkspace,
        dpgfSource,
      })
    ) {
      setShowOnboardingBanner(true);
    }
    toast.success({
      title: "Affaire créée !",
      description: dpgfSource
        ? "DPGF lie — importez-la depuis l'editeur pour pre-remplir le devis."
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
  const hasDominantClarificationSuggestion = useMemo(
    () => visibleCockpitSuggestions.some((suggestion) => suggestion.actionId === "list-clarifications"),
    [visibleCockpitSuggestions],
  );
  const hasDominantRevalidationSuggestion = useMemo(
    () => visibleCockpitSuggestions.some((suggestion) => suggestion.actionId === "review-revalidation"),
    [visibleCockpitSuggestions],
  );
  const dominantFlowIntent = useMemo(
    () => getAffaireHubDominantIntent(visibleCockpitSuggestions),
    [visibleCockpitSuggestions],
  );
  const preferLinkedDpgfImportAction = useMemo(
    () =>
      shouldPreferLinkedDpgfImportAction({
        summary,
        dpgfSource,
      }),
    [summary, dpgfSource],
  );
  const commandBarSuggestions = useMemo(
    () =>
      filterAffaireHubCommandBarSuggestionsForLinkedDpgf(
        filterAffaireHubCommandBarSuggestions(cockpitState, dominantFlowIntent),
        preferLinkedDpgfImportAction,
      ),
    [cockpitState, dominantFlowIntent, preferLinkedDpgfImportAction],
  );
  const intakeWorkspacePresentation = useMemo(
    () =>
      getAffaireHubIntakeWorkspacePresentation({
        dominantIntent: dominantFlowIntent,
        isReadOnlyReview,
      }),
    [dominantFlowIntent, isReadOnlyReview],
  );
  const hiddenPilotageExceptionIds = useMemo(() => {
    return getAffaireHubHiddenPilotageExceptionIds({
      dominantIntent: dominantFlowIntent,
      hasDominantClarificationSuggestion,
      hasDominantRevalidationSuggestion,
    });
  }, [dominantFlowIntent, hasDominantClarificationSuggestion, hasDominantRevalidationSuggestion]);
  const isFreshStartState = isAffaireFreshStartState({
    intakeWorkspace,
    dpgfSource,
    lineCount: summary.lineCount,
  });

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
      {/* Breadcrumb + actions bar */}
      <div className="mb-4 flex min-w-0 items-center justify-between gap-2 sm:gap-4">
        <nav aria-label="Fil d'Ariane" className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center gap-1.5 text-sm text-[var(--slate-500)]">
            <li>
              <BackToListLink />
            </li>
            <li aria-hidden="true" className="text-[var(--slate-300)]">/</li>
            <li className="min-w-0 truncate font-medium text-[var(--slate-700)]">
              {summary.project.name}
            </li>
          </ol>
        </nav>

        {!isReadOnlyReview && editingProject ? (
          <div ref={setActionsPortalTarget} />
        ) : null}
      </div>

      {/* Onboarding banner (post-creation, no dossier) */}
      {shouldShowAffaireCreatedOnboardingBanner({
        showOnboardingBanner,
        intakeWorkspace,
        dpgfSource,
      }) && (
        <AffaireCreatedOnboardingBanner
          manualEstimateHref={
            summary.currentVersion?.status === "draft"
              ? `/dashboard/estimates/${summary.currentVersion.id}/edit?entry=manual`
              : `/dashboard/estimates/new?projectId=${summary.project.id}`
          }
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

      {/* Project details fiche — same style as creation page */}
      {!isReadOnlyReview ? (
        <div className="mb-4">
          <AffairePersistedProjectDetails
            projectId={summary.project.id}
            initialValues={{
              projectName: summary.project.name,
              clientName: summary.project.clientName ?? "",
              reference: summary.project.reference ?? "",
            }}
            editing={editingProject}
            onEditingChange={setEditingProject}
            actionsPortalTarget={actionsPortalTarget}
            toolbar={
              !showImportFlow ? (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
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
                    {commandBarSuggestions.length > 0 && (
                      <>
                        <div className="mx-0.5 h-5 w-px bg-[var(--slate-200)]" />
                        <CockpitCommandBar
                          suggestions={commandBarSuggestions}
                          onExecute={handleExecuteCockpitSuggestion}
                          onToggleHidden={(actionId, isHidden) => {
                            handleToggleCockpitPreference({ actionId, isHidden });
                          }}
                          onTogglePinned={(actionId, isPinned) => {
                            handleToggleCockpitPreference({ actionId, isPinned });
                          }}
                        />
                      </>
                    )}
                  </div>
                  {actionError && (
                    <div className="alert alert-error px-3 py-2 text-xs">
                      {actionError}
                    </div>
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
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="mb-4">
          <h1 className="page-title truncate">{summary.project.name}</h1>
        </div>
      )}

      {!isFreshStartState ? (
        <div className="mb-4 rounded-xl border border-[var(--slate-200)] bg-white px-3 py-3 shadow-sm md:hidden">
          <AffaireWorkflowStepper
            summary={summary}
            dpgfSource={dpgfSource}
            intakeWorkspace={intakeWorkspace}
            approvalSummary={approvalSummary}
            lineCount={summary.lineCount}
          />
        </div>
      ) : null}

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
              hubReadiness={summary.hubReadiness ?? null}
              currentVersion={summary.currentVersion ?? null}
              versionZeroSummary={versionZeroSummary}
              takeoffEnabled={takeoffEnabled}
              plansSummary={plansSummary ?? null}
              intakeWorkspace={intakeWorkspace ?? null}
              dpgfSource={dpgfSource}
              registerSummary={registerSummary ?? null}
              finishLineSummary={finishLineSummary ?? null}
              structureMode={summary.structureMode ?? null}
              cockpitSuggestions={visibleCockpitSuggestions}
              onExecuteSuggestion={handleExecuteCockpitSuggestion}
            />
          </div>

          {!isFreshStartState ? (
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
                structureMode={summary.structureMode ?? null}
                finishLineSummary={finishLineSummary ?? null}
                takeoffEnabled={takeoffEnabled}
                hiddenExceptionIds={hiddenPilotageExceptionIds}
                onOpenSurface={
                  isReadOnlyReview
                    ? undefined
                    : (surfaceId) => {
                        openHubSurface(surfaceId);
                      }
                }
              />
            </div>
          ) : null}

          {!isFreshStartState ? (
            <AffaireProgressStrip summary={summary} dpgfSource={dpgfSource} />
          ) : null}

          {directionSignals && directionSignals.alerts.length > 0 ? (
            <div className="mt-4">
              <RiskAlertBanner alerts={directionSignals.alerts} compact />
            </div>
          ) : null}

          {/* Two-column layout (Recommendation #3)
              Left: operational flow (intake, brief, financial, DPGF, timeline)
              Right: control (register, approval, journal, plans) */}
          <div className={`mt-3 grid grid-cols-1 gap-4${isFreshStartState ? "" : " lg:grid-cols-5"}`}>
            <div className={`space-y-4${isFreshStartState ? "" : " lg:col-span-3"}`}>
              {/* Intake workspace: document upload, classification triage */}
              {intakeWorkspace !== undefined && (
                <div id="intake" className="scroll-mt-24">
                  <IntakeWorkspace
                    projectId={summary.project.id}
                    workspace={intakeWorkspace}
                    entryMode={isFreshStartState}
                    hideAddFilesAction={intakeWorkspacePresentation.hideAddFilesAction}
                    hideMissingPiecesAction={intakeWorkspacePresentation.hideMissingPiecesAction}
                    onBridgeDpgfImport={
                      !intakeWorkspacePresentation.showBridgeDpgfImport
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
              {!isFreshStartState && intakeWorkspace !== undefined && (
                <div id="brief" className="scroll-mt-24">
                  <BriefDraftCard
                    projectId={summary.project.id}
                    briefDraft={intakeWorkspace?.briefDraft ?? null}
                    isReadOnly={isReadOnlyReview}
                    hideConfirmAction={dominantFlowIntent === "confirm_brief"}
                  />
                </div>
              )}
              {!isFreshStartState ? (
                <FinancialSummaryCard
                  summary={summary}
                  canEditMargin={
                    !isReadOnlyReview && summary.currentVersion?.status === "draft"
                  }
                />
              ) : null}
              {!isFreshStartState && isExpert && (
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
              {!isFreshStartState ? (
                <VersionTimelineCard
                  timeline={timeline}
                  projectId={summary.project.id}
                  currentVersionId={currentVersionId}
                  acceptedVersionId={acceptedVersionId}
                  isReadOnlyReview={isReadOnlyReview}
                  errorMessage={sectionErrors?.timeline}
                />
              ) : null}
            </div>

            {!isFreshStartState ? <div className="space-y-4 lg:col-span-2">
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
                    hideLaunchAction={
                      shouldHideAffaireHubTakeoffLaunchAction({
                        dominantIntent: dominantFlowIntent,
                        hasDominantClarificationSuggestion,
                        hasDominantRevalidationSuggestion,
                      })
                    }
                    onLaunchMetre={
                      isReadOnlyReview ? undefined : () => setShowLaunchMetreDialog(true)
                    }
                  />
                </div>
              ) : null}
            </div> : null}
          </div>
        </>
      )}

      {!isFreshStartState ? (
        <div className="sticky bottom-0 z-10 -mx-6 mt-6 hidden border-t border-[var(--slate-200)] bg-white/95 px-6 py-3 backdrop-blur-sm md:block">
          <AffaireWorkflowStepper
            summary={summary}
            dpgfSource={dpgfSource}
            intakeWorkspace={intakeWorkspace}
            approvalSummary={approvalSummary}
            lineCount={summary.lineCount}
          />
        </div>
      ) : null}

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
