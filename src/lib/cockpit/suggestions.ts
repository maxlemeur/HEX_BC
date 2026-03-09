import type { AffaireHubPlansSummaryData } from "@/components/affaires/PlansMetresCard";
import type { AffaireRegisterSummary } from "@/lib/affaires/register";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";
import { canLaunchNewTakeoffAnalysis } from "@/lib/takeoff/visible-status";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type CockpitIntent =
  | "analyze_plans"
  | "generate_structure" // reserved, not computed yet
  | "view_exceptions"
  | "list_hypotheses"
  | "prepare_validation";

export type CockpitSuggestionTarget =
  | { kind: "navigate"; href: string }
  | { kind: "open_dialog"; dialogId: string }
  | { kind: "scroll_to_section"; sectionId: string };

export type CockpitSuggestion = {
  actionId: string;
  label: string;
  intent: CockpitIntent;
  preview: string;
  target: CockpitSuggestionTarget;
  requiresConfirmation: boolean;
  confirmTone: "info" | "warning";
};

/* ------------------------------------------------------------------ */
/*  Input                                                              */
/* ------------------------------------------------------------------ */

export type ComputeCockpitSuggestionsInput = {
  projectId: string;
  takeoffEnabled: boolean;
  isReadOnlyReview: boolean;
  plansSummary: AffaireHubPlansSummaryData | null;
  registerSummary: AffaireRegisterSummary | null;
  approvalSummary: EstimateApprovalSummary | null;
};

/* ------------------------------------------------------------------ */
/*  Engine                                                             */
/* ------------------------------------------------------------------ */

export function computeCockpitSuggestions(
  input: ComputeCockpitSuggestionsInput,
): CockpitSuggestion[] {
  const suggestions: CockpitSuggestion[] = [];
  const {
    projectId,
    takeoffEnabled,
    isReadOnlyReview,
    plansSummary,
    registerSummary,
    approvalSummary,
  } = input;

  // 1. analyze_plans
  if (
    takeoffEnabled &&
    plansSummary &&
    plansSummary.planSetCount > 0 &&
    canLaunchNewTakeoffAnalysis(plansSummary.latestJob?.status) &&
    !isReadOnlyReview
  ) {
    suggestions.push({
      actionId: "analyze-plans",
      label: "Analyser les plans",
      intent: "analyze_plans",
      preview:
        "Lancer une analyse automatique des plans pour extraire les metres.",
      target: { kind: "open_dialog", dialogId: "launch-metre" },
      requiresConfirmation: false,
      confirmTone: "info",
    });
  }

  // 2. view_exceptions
  if (
    plansSummary &&
    plansSummary.exceptionCount != null &&
    plansSummary.exceptionCount > 0 &&
    plansSummary.latestJob &&
    (plansSummary.latestJob.status === "completed" ||
      plansSummary.latestJob.status === "review_required")
  ) {
    const { latestJob, exceptionCount } = plansSummary;
    suggestions.push({
      actionId: "view-exceptions",
      label: `Voir les ${exceptionCount} exception${exceptionCount !== 1 ? "s" : ""}`,
      intent: "view_exceptions",
      preview: `${exceptionCount} ecart${exceptionCount !== 1 ? "s" : ""} majeur${exceptionCount !== 1 ? "s" : ""} detecte${exceptionCount !== 1 ? "s" : ""} entre le DPGF et les metres extraits.`,
      target: {
        kind: "navigate",
        href: `/dashboard/affaires/${projectId}/takeoff/${latestJob.jobId}/review?versionId=${latestJob.reviewVersionId}&view=dpgf&dpgfView=exceptions_only`,
      },
      requiresConfirmation: false,
      confirmTone: "info",
    });
  }

  // 3. list_hypotheses
  if (registerSummary && registerSummary.openQuestionsCount > 0) {
    const count = registerSummary.openQuestionsCount;
    suggestions.push({
      actionId: "list-hypotheses",
      label: `${count} hypothese${count !== 1 ? "s" : ""} ouverte${count !== 1 ? "s" : ""}`,
      intent: "list_hypotheses",
      preview: `${count} point${count !== 1 ? "s" : ""} du registre necessitent une decision.`,
      target: {
        kind: "navigate",
        href: `/dashboard/affaires/${projectId}?registerStatus=open`,
      },
      requiresConfirmation: false,
      confirmTone: "info",
    });
  }

  // 4. prepare_validation
  if (approvalSummary?.permissions.canPrepareRequest) {
    suggestions.push({
      actionId: "prepare-validation",
      label: "Preparer la validation",
      intent: "prepare_validation",
      preview: "Soumettre le chiffrage pour validation par la direction.",
      target: { kind: "open_dialog", dialogId: "approval-submit" },
      requiresConfirmation: true,
      confirmTone: "info",
    });
  }

  return suggestions;
}
