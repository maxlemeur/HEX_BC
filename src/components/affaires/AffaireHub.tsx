"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EstimateApprovalActions } from "@/components/estimates/EstimateApprovalActions";
import { PlanDossierSyncNotice } from "@/components/takeoff/PlanDossierSyncNotice";
import { EstimateApprovalDecisionJournalCard } from "@/components/estimates/EstimateApprovalDecisionJournalCard";
import { EstimateApprovalSummaryCard } from "@/components/estimates/EstimateApprovalSummaryCard";
import { RiskAlertBanner } from "@/components/direction/RiskAlertBanner";
import {
  createEstimateVariant,
  duplicateEstimateVersion,
  type VersionZeroDraftSummary,
} from "@/lib/estimates/client";
import type { DirectionSyntheticAlert } from "@/lib/direction/alerts";
import { useUiMode } from "@/hooks/useUiMode";
import type {
  AffaireHubDpgfSourceResult,
  AffaireHubFinishLineSummaryResult,
  AffaireHubMarginCardData,
  AffaireHubSummaryResult,
  AffaireHubTimelineResult,
} from "@/lib/affaires/server";
import type { EstimateApprovalDecisionJournal } from "@/lib/estimates/approval-decision-journal";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";
import type { ConfirmUnifiedImportFlowResult } from "@/app/dashboard/affaires/_actions/import-flow";

import { useToast } from "@/components/ui-legacy/Toast";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import type { IntakeDpgfCandidate } from "./unified-import-flow/types";
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
import { AffaireHubActionBar, AffaireHubFirstVersionActionBar } from "./AffaireHubActionBar";
import {
  DpgfSourceCard,
  FinancialSummaryCard,
  VersionTimelineCard,
} from "./AffaireHubSections";
import {
  TakeoffLaunchPrompt,
  shouldShowTakeoffPrompt,
} from "@/components/takeoff/TakeoffLaunchPrompt";
import { useTakeoffAutoProposeDismissed } from "@/hooks/useTakeoffAutoProposeDismissed";
import type { CockpitIntent, CockpitSuggestion } from "@/lib/cockpit/suggestions";
import { sortCockpitSuggestions } from "@/lib/cockpit/suggestions";
import type { CockpitSurfaceId } from "@/lib/cockpit/suggestions";
import { CockpitDecisionSuggestionCard } from "@/components/cockpit/CockpitDecisionSuggestionCard";
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
import {
  COCKPIT_EXECUTE_ACTION_EVENT,
  dispatchCockpitOpenSurface,
  type CockpitExecuteActionEventDetail,
} from "@/lib/cockpit/events";
import { XIcon } from "lucide-react";

export { DpgfSourceCard, getEstimateMarginSettingsHref } from "./AffaireHubSections";

const AffaireDocumentsDrawer = dynamic(
  () => import("./AffaireDocumentsDrawer").then((module) => module.AffaireDocumentsDrawer),
  { ssr: false },
);

const UnifiedImportFlow = dynamic(
  () => import("./UnifiedImportFlow").then((module) => module.UnifiedImportFlow),
  {
    ssr: false,
    loading: () => (
      <Card role="status" className="p-8 text-sm text-muted-foreground">
        Chargement de l’import…
      </Card>
    ),
  }
);

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type AffaireHubProps = {
  summary: AffaireHubSummaryResult;
  timeline: AffaireHubTimelineResult | null;
  dpgfSource: AffaireHubDpgfSourceResult;
  marginAnalysis?: AffaireHubMarginCardData;
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

/**
 * Démarrage du hub : ni document, ni DPGF lié, ni ligne dans aucune version de l'affaire (décision du 18/10/2026).
 * Une V2 vierge après une V1 chiffrée garde le hub complet, V1 comprise.
 */
export function isAffaireFreshStartState(input: {
  intakeWorkspace: Pick<AffaireIntakeWorkspace, "documents"> | null | undefined;
  dpgfSource: AffaireHubDpgfSourceResult;
  affaireHasLines: boolean;
}) {
  return (
    (input.intakeWorkspace?.documents?.length ?? 0) === 0 &&
    !input.dpgfSource &&
    !input.affaireHasLines
  );
}

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
  const documentSearchParams = useSearchParams();
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [documentsRequested, setDocumentsRequested] = useState(false);
  const documentsReturnFocus = useRef<HTMLElement | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(() => [...documentSearchParams.keys()].some((key) => /^(register|approval|timeline)/.test(key)));
  const openDocuments = useCallback(() => {
    if (document.activeElement instanceof HTMLElement && !document.activeElement.closest(".affaire-documents-drawer")) {
      documentsReturnFocus.current = document.activeElement;
    }
    setDocumentsRequested(true);
    setDocumentsOpen(true);
  }, []);
  const toast = useToast();
  const { isExpert } = useUiMode();
  const currentVersionId = summary.currentVersion?.id ?? null;
  const acceptedVersionId = summary.acceptedVersion?.id ?? null;
  const {
    dismissed: promptPermanentlyDismissed,
    temporarilyDismissed: promptTemporarilyDismissed,
    dismissPermanently: dismissPromptPermanently,
    dismissTemporarily: dismissPromptTemporarily,
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
        ? "DPGF liée — importez-la depuis l'éditeur pour pré-remplir le devis."
        : undefined,
    });
  }, [justCreated, router, summary.project.id, toast, dpgfSource, intakeWorkspace]);

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
    affaireHasLines: summary.affaireHasLines,
  }) && (plansSummary?.planFileCount ?? 0) === 0;

  const focusedIntakeDocument = documentSearchParams.get("intakeDocument");
  const focusedIntakeFilter = documentSearchParams.get("intakeFilter");
  const focusedHubQuery = documentSearchParams.toString();
  useEffect(() => {
    const revealLinkedSurface = (fromHashChange = false) => {
      const hash = window.location.hash;
      const isDetailsLink = ["#brief", "#register", "#approval", "#timeline", "#plans"].includes(hash);
      if (!isFreshStartState && !isDetailsLink && (hash === "#intake" || (!fromHashChange && (focusedIntakeDocument || focusedIntakeFilter)))) {
        openDocuments();
      }
      if (isDetailsLink) {
        setDetailsOpen(true);
        requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" }));
      }
    };
    revealLinkedSurface();
    const onHashChange = () => revealLinkedSurface(true);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [focusedIntakeDocument, focusedIntakeFilter, focusedHubQuery, isFreshStartState, openDocuments]);

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

      if (surfaceId === "intake-upload") {
        openDocuments();
        return;
      }
      setDetailsOpen(true);
      const sectionId = sectionBySurface[surfaceId];
      requestAnimationFrame(() => document.getElementById(sectionId)?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      }));

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
    [summary.project.id, openDocuments],
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
    dominantFlowIntent === "analyze_plans" &&
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
  const [intakeDpgfCandidates, setIntakeDpgfCandidates] = useState<IntakeDpgfCandidate[]>([]);
  const [importResult, setImportResult] =
    useState<ConfirmUnifiedImportFlowResult | null>(null);

  const handleImportComplete = useCallback(
    (result: ConfirmUnifiedImportFlowResult) => {
      setShowImportFlow(false);
      setImportResult(result);
      const params = new URLSearchParams(window.location.search);
      params.set("view", "overview");
      router.push(`/dashboard/affaires/${summary.project.id}?${params}#dpgf`);
      router.refresh();
    },
    [router, summary.project.id],
  );


  return (
    <div className="animate-fade-in" onClickCapture={(event) => {
      const link = (event.target as HTMLElement).closest("a[href]");
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const url = new URL(link.getAttribute("href")!, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;
      if (url.hash === "#intake" && !isFreshStartState) {
        event.preventDefault();
        if (url.href !== window.location.href) window.history.pushState(null, "", url);
        openDocuments();
        return;
      }
      if (url.search !== window.location.search) return;
      if (["#brief", "#register", "#approval", "#timeline", "#plans"].includes(url.hash)) {
        setDetailsOpen(true);
        requestAnimationFrame(() => document.getElementById(url.hash.slice(1))?.scrollIntoView({ block: "start" }));
      }
    }}>
      {intakeWorkspace?.canManageDocuments && intakeWorkspace.uploadId && !isReadOnlyReview ? (
        <PlanDossierSyncNotice projectId={summary.project.id} automatic onSynchronized={(changed) => { if (changed) router.refresh(); }} />
      ) : null}

      {/* Breadcrumb + edit actions (portal target while the fiche is edited) */}
      {!isReadOnlyReview ? (
        <div className="mb-4 flex min-w-0 items-center justify-between gap-2 sm:gap-4">
          <Breadcrumbs
            className="flex-1"
            items={[
              { label: "Affaires", href: "/dashboard/affaires" },
              { label: summary.project.name },
            ]}
          />
          {editingProject ? <div ref={setActionsPortalTarget} /> : null}
        </div>
      ) : null}

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
            setIntakeDpgfCandidates([]);
            setShowImportFlow(true);
          }}
        />
      )}

      {/* Project details fiche — same style as creation page */}
      {!isReadOnlyReview ? (
        <div className="mb-4">
          <AffairePersistedProjectDetails
            projectId={summary.project.id}
            initialValues={{
              projectName: summary.project.name,
              clientName: summary.project.clientName ?? "",
              siteAddress: summary.project.siteAddress ?? "",
              reference: summary.project.reference ?? "",
            }}
            editing={editingProject}
            onEditingChange={setEditingProject}
            actionsPortalTarget={actionsPortalTarget}
            toolbar={
              !showImportFlow ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {summary.versionsCount === 0 ? (
                      <AffaireHubFirstVersionActionBar projectId={summary.project.id} />
                    ) : summary.versionsCount > 0 ? (
                      <AffaireHubActionBar
                        summary={summary}
                        versionZeroSummary={versionZeroSummary}
                        takeoffEnabled={takeoffEnabled}
                        plansSummary={plansSummary}
                        freshStart={isFreshStartState}
                        pendingAction={pendingAction}
                        onDuplicate={() => void handleDuplicate()}
                        onCreateVariant={() => void handleCreateVariant()}
                        onLaunchMetre={() => setShowLaunchMetreDialog(true)}
                      />
                    ) : null}
                    {commandBarSuggestions.length > 0 && (
                      <>
                        <div aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
                        <CockpitDecisionSuggestionCard projectId={summary.project.id} suggestions={visibleCockpitSuggestions} />
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
                    <Alert variant="danger">
                      <AlertDescription className="text-danger">{actionError}</AlertDescription>
                    </Alert>
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
        <>
          <PageHeader
            className="mb-4 sm:mb-4"
            title={summary.project.name}
            breadcrumbs={[
              { label: "Affaires", href: "/dashboard/affaires" },
              { label: summary.project.name },
            ]}
          />
          {/* Read-only review banner for director */}
          <Alert variant="info" className="mb-4">
            <AlertTitle>Mode revue</AlertTitle>
            <AlertDescription>
              Consultation uniquement : les actions d&apos;édition sont réservées aux ingénieurs.
            </AlertDescription>
          </Alert>
        </>
      )}

      {/* Import result summary banner */}
      {importResult && (
        <Alert variant="success" className="mb-4 animate-fade-in">
          <div className="flex items-start justify-between gap-3">
            <div>
              <AlertTitle className="text-foreground">Import terminé</AlertTitle>
              <AlertDescription className="mt-0.5 text-xs">
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
              </AlertDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Fermer le résumé d’import"
              onClick={() => setImportResult(null)}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </div>
        </Alert>
      )}

      {/* Unified Import Flow (full-width, replaces grid when active) */}
      {showImportFlow ? (
        <UnifiedImportFlow
          projectId={summary.project.id}
          intakeDpgfCandidates={intakeDpgfCandidates}
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
                        updatedAt: summary.currentVersion.updatedAt,
                      }
                    : null
                }
                lineCount={summary.lineCount}
                structureMode={summary.structureMode ?? null}
                finishLineSummary={finishLineSummary ?? null}
                takeoffEnabled={takeoffEnabled}
                plansError={sectionErrors?.plansSummary}
                onOpenDocuments={openDocuments}
                studyContent={
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
              preparationIsNextStep={dominantFlowIntent === "analyze_plans"}
              hidePreparationAction={showTakeoffPrompt}
              onExecuteSuggestion={handleExecuteCockpitSuggestion}
            />
                }
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

          {directionSignals && directionSignals.alerts.length > 0 ? (
            <div className="mt-4">
              <RiskAlertBanner alerts={directionSignals.alerts} compact />
            </div>
          ) : null}

          <details className="affaire-hub-details" open={isFreshStartState || detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
            <summary>Détails du dossier et du devis</summary>
            {summary.currentVersion && (finishLineSummary?.readyToOrder.counts?.totalSupplierLines ?? 0) > 0 ? <a className="journey-text-action mt-3" href="#finish-line-orders">Préparer les achats de cette version</a> : null}
          {/* Two-column layout (Recommendation #3)
              Left: operational flow (intake, brief, financial, DPGF, timeline)
              Right: control (register, approval, journal, plans) */}
          <div className={`mt-3 grid grid-cols-1 gap-4${isFreshStartState ? "" : " lg:grid-cols-5"}`}>
            <div className={`space-y-4${isFreshStartState ? "" : " lg:col-span-3"}`}>
              {/* Intake workspace: document upload, classification triage */}
              {isFreshStartState && intakeWorkspace !== undefined && (
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
                            setIntakeDpgfCandidates((intakeWorkspace?.documents ?? [])
                              .filter((document) => !document.isBeingDeleted && document.detectedCategory === "dpgf" &&
                                document.classificationStatus === "classified" && document.uploadStatus === "uploaded")
                              .map((document) => ({
                                documentId: document.documentId,
                                fileName: document.fileName,
                                label: `${document.fileName}${document.documentPriority === "primary" ? " · principale" : ""}${document.driveSource ? ` · ${document.driveSource.folderName ?? "Drive"} · version ${document.driveSource.revision}` : ""} · copie ${document.documentId.slice(-8)}`,
                              })));
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
                    hasPlans={Boolean(intakeWorkspace && !intakeWorkspace.missingPieces.some((piece) => piece.code === "missing_plans"))}
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
                          setIntakeDpgfCandidates([]);
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
          </details>
        </>
      )}

      {documentsRequested && intakeWorkspace ? (
        <AffaireDocumentsDrawer
          documentScope={`${focusedIntakeDocument ?? ""}:${focusedIntakeFilter ?? ""}`}
          returnFocus={documentsReturnFocus}
          open={documentsOpen}
          onOpenChange={(open) => {
            setDocumentsOpen(open);
            if (!open && documentSearchParams.has("briefBlock")) {
              setDetailsOpen(true);
              const params = new URLSearchParams(documentSearchParams.toString());
              for (const key of ["intakeDocument", "briefBlock", "briefEntry"]) params.delete(key);
              window.history.replaceState(null, "", `/dashboard/affaires/${summary.project.id}${params.size ? `?${params}` : ""}#brief`);
            }
          }}
          projectId={summary.project.id}
          projectName={summary.project.name}
          workspace={intakeWorkspace}
          canManage={Boolean(intakeWorkspace.canManageDocuments && !isReadOnlyReview)}
          onOverview={(anchor) => {
            setDocumentsOpen(false);
            if (anchor) {
              setDetailsOpen(true);
              requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }));
            }
          }}
          onImportDpgf={(documentId) => {
            const document = intakeWorkspace.documents.find((item) => item.documentId === documentId && !item.isBeingDeleted && item.uploadStatus === "uploaded" && item.classificationStatus === "classified" && item.detectedCategory === "dpgf");
            if (!document || isReadOnlyReview || !intakeWorkspace.canManageDocuments) return;
            setIntakeDpgfCandidates([{ documentId, fileName: document.fileName, label: document.fileName }]);
            setDocumentsOpen(false);
            setImportResult(null);
            setShowImportFlow(true);
          }}
        />
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
