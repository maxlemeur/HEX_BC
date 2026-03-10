import type { AffaireHubPlansSummaryData } from "@/components/affaires/PlansMetresCard";
import { buildAffaireRegisterHubHref, type AffaireRegisterSummary } from "@/lib/affaires/register";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";
import type { VersionZeroDraftSummary } from "@/lib/estimates/version-zero-drafts";
import { canLaunchNewTakeoffAnalysis } from "@/lib/takeoff/visible-status";

export type CockpitIntent =
  | "add_files"
  | "review_intake"
  | "add_missing_pieces"
  | "confirm_brief"
  | "analyze_plans"
  | "generate_structure"
  | "view_exceptions"
  | "list_hypotheses"
  | "prepare_validation";

export type CockpitSurfaceId =
  | "intake-upload"
  | "brief-confirm"
  | "approval-submit"
  | "launch-metre";

export type CockpitSuggestionTarget =
  | { kind: "navigate"; href: string }
  | { kind: "open_surface"; surfaceId: CockpitSurfaceId };

export type CockpitSuggestion = {
  actionId: string;
  label: string;
  intent: CockpitIntent;
  preview: string;
  target: CockpitSuggestionTarget;
  requiresConfirmation: boolean;
  confirmTone: "info" | "warning";
  priority: number;
  isPinned: boolean;
  isHidden: boolean;
};

export type CockpitCommandPreference = {
  actionId: string;
  isPinned: boolean;
  isHidden: boolean;
};

export type ComputeCockpitSuggestionsInput = {
  projectId: string;
  takeoffEnabled: boolean;
  isReadOnlyReview: boolean;
  plansSummary: AffaireHubPlansSummaryData | null;
  registerSummary: AffaireRegisterSummary | null;
  approvalSummary: EstimateApprovalSummary | null;
  hasIntakeWorkspaceError?: boolean;
  intakeWorkspace: Pick<
    AffaireIntakeWorkspace,
    "uploadId" | "documents" | "missingPieces" | "briefDraft"
  > | null;
  versionZeroSummary: Pick<VersionZeroDraftSummary, "canGenerate" | "activeDraft"> | null;
  currentVersion: { id: string; status: string } | null;
  lineCount?: number;
  preferences?: CockpitCommandPreference[];
};

function byPriority(left: CockpitSuggestion, right: CockpitSuggestion) {
  if (left.isPinned !== right.isPinned) {
    return left.isPinned ? -1 : 1;
  }
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  return left.label.localeCompare(right.label, "fr");
}

function isDocumentProcessing(
  document: NonNullable<ComputeCockpitSuggestionsInput["intakeWorkspace"]>["documents"][number],
) {
  return (
    document.confidence === 0 &&
    document.detectedCategory === "a_classer" &&
    document.issues.length === 0
  );
}

function countDocumentsNeedingReview(
  intakeWorkspace: ComputeCockpitSuggestionsInput["intakeWorkspace"],
) {
  if (!intakeWorkspace) {
    return 0;
  }

  return intakeWorkspace.documents.filter(
    (document) =>
      !isDocumentProcessing(document) &&
      (document.detectedCategory === "a_classer" || document.confidence < 0.65),
  ).length;
}

function createSuggestion(
  input: Omit<CockpitSuggestion, "isPinned" | "isHidden">,
): CockpitSuggestion {
  return {
    ...input,
    isPinned: false,
    isHidden: false,
  };
}

export function sortCockpitSuggestions(suggestions: CockpitSuggestion[]) {
  return [...suggestions].sort(byPriority);
}

export function applyCockpitSuggestionPreferences(input: {
  suggestions: CockpitSuggestion[];
  preferences: CockpitCommandPreference[];
}) {
  const preferenceMap = new Map(
    input.preferences.map((preference) => [preference.actionId, preference] as const),
  );

  return sortCockpitSuggestions(
    input.suggestions.map((suggestion) => {
      const preference = preferenceMap.get(suggestion.actionId);
      if (!preference) {
        return suggestion;
      }

      return {
        ...suggestion,
        isPinned: preference.isPinned,
        isHidden: preference.isHidden,
      };
    }),
  );
}

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
    hasIntakeWorkspaceError = false,
    intakeWorkspace,
    versionZeroSummary,
    currentVersion,
    preferences = [],
  } = input;
  const reviewDocumentsCount = countDocumentsNeedingReview(intakeWorkspace);
  const missingPiecesCount = intakeWorkspace?.missingPieces.length ?? 0;
  const hasDocuments = (intakeWorkspace?.documents.length ?? 0) > 0;
  const briefDraft = intakeWorkspace?.briefDraft ?? null;

  // Only show "add files" when documents already exist (dropzone handles the empty state)
  if (!hasIntakeWorkspaceError && hasDocuments && !isReadOnlyReview) {
    suggestions.push(
      createSuggestion({
        actionId: "add-files",
        label: "Ajouter des fichiers",
        intent: "add_files",
        preview: "Ajouter des pieces supplementaires au dossier de consultation.",
        target: { kind: "open_surface", surfaceId: "intake-upload" },
        requiresConfirmation: false,
        confirmTone: "info",
        priority: 900,
      }),
    );
  }

  if (!hasIntakeWorkspaceError && reviewDocumentsCount > 0 && !isReadOnlyReview) {
    suggestions.push(
      createSuggestion({
        actionId: "review-intake",
        label: `Confirmer ${reviewDocumentsCount} piece${reviewDocumentsCount > 1 ? "s" : ""} a revoir`,
        intent: "review_intake",
        preview:
          "Verifier les documents ambigus ou mal classes avant de poursuivre le cadrage du dossier.",
        target: {
          kind: "navigate",
          href: `/dashboard/affaires/${projectId}?intakeFilter=a_revoir#intake`,
        },
        requiresConfirmation: false,
        confirmTone: "info",
        priority: 850,
      }),
    );
  }

  if (!hasIntakeWorkspaceError && missingPiecesCount > 0 && !isReadOnlyReview) {
    suggestions.push(
      createSuggestion({
        actionId: "add-missing-pieces",
        label: `Ajouter ${missingPiecesCount} piece${missingPiecesCount > 1 ? "s" : ""} manquante${missingPiecesCount > 1 ? "s" : ""}`,
        intent: "add_missing_pieces",
        preview: "Completer le dossier avec les pieces manquantes detectees pendant l'intake.",
        target: { kind: "open_surface", surfaceId: "intake-upload" },
        requiresConfirmation: false,
        confirmTone: "info",
        priority: 800,
      }),
    );
  }

  if (
    !hasIntakeWorkspaceError &&
    briefDraft?.status === "a_confirmer" &&
    !isReadOnlyReview
  ) {
    suggestions.push(
      createSuggestion({
        actionId: "confirm-brief",
        label: "Confirmer le brief affaire",
        intent: "confirm_brief",
        preview:
          "Valider le cadrage du dossier pour debloquer la suite du chiffrage assiste.",
        target: { kind: "open_surface", surfaceId: "brief-confirm" },
        requiresConfirmation: true,
        confirmTone: "info",
        priority: 750,
      }),
    );
  }

  if (
    currentVersion?.status === "draft" &&
    versionZeroSummary &&
    (versionZeroSummary.activeDraft || versionZeroSummary.canGenerate) &&
    !isReadOnlyReview
  ) {
    const hasActiveDraft = Boolean(versionZeroSummary.activeDraft);
    suggestions.push(
      createSuggestion({
        actionId: "generate-structure",
        label: hasActiveDraft
          ? "Revoir la structure du devis"
          : "Generer la structure du devis",
        intent: "generate_structure",
        preview: hasActiveDraft
          ? "Reprendre la revue de la V0 IA avant materialisation dans le devis."
          : "Generer une V0 IA a partir du brief confirme et des lots detectes.",
        target: {
          kind: "navigate",
          href: `/dashboard/estimates/${currentVersion.id}/edit?openVersionZero=1`,
        },
        requiresConfirmation: false,
        confirmTone: "info",
        priority: 650,
      }),
    );
  }

  if (
    takeoffEnabled &&
    plansSummary &&
    plansSummary.planSetCount > 0 &&
    canLaunchNewTakeoffAnalysis(plansSummary.latestJob?.status) &&
    !isReadOnlyReview
  ) {
    suggestions.push(
      createSuggestion({
        actionId: "analyze-plans",
        label: "Analyser les plans",
        intent: "analyze_plans",
        preview:
          "Lancer une analyse automatique des plans pour extraire les metres.",
        target: { kind: "open_surface", surfaceId: "launch-metre" },
        requiresConfirmation: false,
        confirmTone: "info",
        priority: 500,
      }),
    );
  }

  if (
    plansSummary &&
    plansSummary.exceptionCount != null &&
    plansSummary.exceptionCount > 0 &&
    plansSummary.latestJob &&
    (plansSummary.latestJob.status === "completed" ||
      plansSummary.latestJob.status === "review_required")
  ) {
    const { latestJob, exceptionCount } = plansSummary;
    suggestions.push(
      createSuggestion({
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
        priority: 450,
      }),
    );
  }

  if (registerSummary && registerSummary.openQuestionsCount > 0) {
    const count = registerSummary.criticalOpenCount > 0
      ? registerSummary.criticalOpenCount
      : registerSummary.openQuestionsCount;
    const isCritical = registerSummary.criticalOpenCount > 0;
    suggestions.push(
      createSuggestion({
        actionId: "list-hypotheses",
        label: isCritical
          ? `Traiter ${count} hypothese${count !== 1 ? "s" : ""} critique${count !== 1 ? "s" : ""}`
          : `Traiter ${count} hypothese${count !== 1 ? "s" : ""} ouverte${count !== 1 ? "s" : ""}`,
        intent: "list_hypotheses",
        preview: isCritical
          ? `${count} point${count !== 1 ? "s" : ""} critique${count !== 1 ? "s" : ""} du registre necessitent un arbitrage prioritaire.`
          : `${count} point${count !== 1 ? "s" : ""} du registre necessitent une decision.`,
        target: {
          kind: "navigate",
          href: `${buildAffaireRegisterHubHref({
            projectId,
            status: "open",
            severity: isCritical ? "critical" : null,
          })}#register`,
        },
        requiresConfirmation: false,
        confirmTone: "info",
        priority: 700,
      }),
    );
  }

  if (
    approvalSummary?.permissions.canPrepareRequest &&
    (input.lineCount ?? 0) > 0
  ) {
    suggestions.push(
      createSuggestion({
        actionId: "prepare-validation",
        label: "Preparer la validation",
        intent: "prepare_validation",
        preview: "Soumettre le chiffrage pour validation par la direction.",
        target: { kind: "open_surface", surfaceId: "approval-submit" },
        requiresConfirmation: true,
        confirmTone: "info",
        priority: 400,
      }),
    );
  }

  return applyCockpitSuggestionPreferences({
    suggestions,
    preferences,
  });
}
