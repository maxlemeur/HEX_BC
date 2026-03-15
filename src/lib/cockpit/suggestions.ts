import type { AffaireHubPlansSummaryData } from "@/components/affaires/PlansMetresCard";
import {
  isAffaireIntakeDocumentNeedingReview,
  resolveAffairePreliminaryStructureCapability,
} from "@/lib/affaires/intake";
import {
  AFFAIRE_REGISTER_REVALIDATION_IMPACTED_STAGE_LABELS,
  buildAffaireRegisterHubHref,
  type AffaireRegisterSummary,
} from "@/lib/affaires/register";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";
import type { EstimateStructureModeSummary } from "@/lib/estimates/structure-mode";
import type { VersionZeroDraftSummary } from "@/lib/estimates/version-zero-drafts";
import { canLaunchNewTakeoffAnalysis } from "@/lib/takeoff/visible-status";

export type CockpitIntent =
  | "add_files"
  | "review_intake"
  | "add_missing_pieces"
  | "confirm_brief"
  | "analyze_plans"
  | "generate_structure"
  | "continue_hybrid"
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
    "uploadId" | "documents" | "missingPieces" | "readiness" | "briefDraft"
  > | null;
  versionZeroSummary: Pick<VersionZeroDraftSummary, "canGenerate" | "activeDraft"> | null;
  currentVersion: { id: string; status: string } | null;
  structureMode?: Pick<
    EstimateStructureModeSummary,
    | "mode"
    | "manualLineCount"
    | "linkedDpgfMappedRowCount"
    | "canImportLinkedDpgfIntoCurrentStructure"
  > | null;
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

function countDocumentsNeedingReview(
  intakeWorkspace: ComputeCockpitSuggestionsInput["intakeWorkspace"],
) {
  if (intakeWorkspace?.readiness) {
    return intakeWorkspace.readiness.reviewDocumentsCount;
  }

  if (!intakeWorkspace) {
    return 0;
  }

  return intakeWorkspace.documents.filter(
    (document) => isAffaireIntakeDocumentNeedingReview(document),
  ).length;
}

function describeMissingPieces(
  intakeWorkspace: ComputeCockpitSuggestionsInput["intakeWorkspace"],
) {
  const readiness = intakeWorkspace?.readiness;
  const missingPiecesCount =
    readiness?.missingPiecesCount ?? intakeWorkspace?.missingPieces.length ?? 0;
  const provisionalMissingPiecesCount = readiness?.provisionalMissingPiecesCount ?? 0;
  const confirmedMissingPiecesCount =
    readiness?.confirmedMissingPiecesCount ??
    Math.max(0, missingPiecesCount - provisionalMissingPiecesCount);
  const provisionalCriticalMissingPiecesCount =
    readiness?.provisionalCriticalMissingPiecesCount ?? 0;
  const plural = missingPiecesCount > 1 ? "s" : "";

  if (missingPiecesCount === 0) {
    return null;
  }

  if (provisionalMissingPiecesCount === 0) {
    return {
      label: `Ajouter ${missingPiecesCount} piece${plural} manquante${plural}`,
      preview:
        "Completer le dossier avec les pieces manquantes detectees pendant l'intake.",
    };
  }

  if (confirmedMissingPiecesCount === 0) {
    return {
      label: `Completer ${missingPiecesCount} piece${plural} potentiellement manquante${plural}`,
      preview:
        provisionalCriticalMissingPiecesCount > 0
          ? "Des pieces a revoir peuvent encore lever un manque critique. Purgez la review avant de conclure que le dossier est incomplet."
          : "Des pieces a revoir peuvent encore lever ces manques. Purgez la review avant de conclure que le dossier est incomplet.",
    };
  }

  const confirmedPlural = confirmedMissingPiecesCount > 1 ? "s" : "";
  return {
    label: `Ajouter ${missingPiecesCount} piece${plural} manquante${plural}`,
    preview: `${confirmedMissingPiecesCount} piece${confirmedPlural} reste${confirmedMissingPiecesCount > 1 ? "nt" : ""} vraiment manquante${confirmedPlural}; ${provisionalMissingPiecesCount} sera${provisionalMissingPiecesCount > 1 ? "ient" : ""} a reconfirmer apres review.`,
  };
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

function describeRevalidationImpactedStages(
  registerSummary: ComputeCockpitSuggestionsInput["registerSummary"],
) {
  const stages = registerSummary?.revalidationImpactedStages ?? [];
  if (stages.length === 0) {
    return null;
  }

  return stages
    .slice(0, 2)
    .map((stage) => AFFAIRE_REGISTER_REVALIDATION_IMPACTED_STAGE_LABELS[stage])
    .join(" + ");
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
    structureMode = null,
    lineCount = 0,
    preferences = [],
  } = input;
  const reviewDocumentsCount = countDocumentsNeedingReview(intakeWorkspace);
  const missingPieces = describeMissingPieces(intakeWorkspace);
  const hasDocuments = (intakeWorkspace?.documents.length ?? 0) > 0;
  const briefDraft = intakeWorkspace?.briefDraft ?? null;
  const preliminaryStructure = resolveAffairePreliminaryStructureCapability({
    briefDraft,
    documents: intakeWorkspace?.documents ?? [],
  });

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

  if (!hasIntakeWorkspaceError && missingPieces && !isReadOnlyReview) {
    suggestions.push(
      createSuggestion({
        actionId: "add-missing-pieces",
        label: missingPieces.label,
        intent: "add_missing_pieces",
        preview: missingPieces.preview,
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
    structureMode?.canImportLinkedDpgfIntoCurrentStructure &&
    !isReadOnlyReview
  ) {
    const preservePreview =
      structureMode.manualLineCount > 0
        ? `Conserver les ${structureMode.manualLineCount} ligne${structureMode.manualLineCount > 1 ? "s" : ""} deja saisie${structureMode.manualLineCount > 1 ? "s" : ""}`
        : "Conserver la structure deja saisie";
    const preview =
      structureMode.linkedDpgfMappedRowCount > 0
        ? `${preservePreview} et importer explicitement ${structureMode.linkedDpgfMappedRowCount} ligne${structureMode.linkedDpgfMappedRowCount > 1 ? "s" : ""} DPGF dans la meme version.`
        : "Conserver les lignes deja saisies et importer explicitement la DPGF source dans la meme version.";

    suggestions.push(
      createSuggestion({
        actionId: "continue-hybrid",
        label: "Passer le devis en hybride",
        intent: "continue_hybrid",
        preview,
        target: {
          kind: "navigate",
          href: `/dashboard/estimates/${currentVersion.id}/edit`,
        },
        requiresConfirmation: false,
        confirmTone: "info",
        priority: 645,
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
    currentVersion?.status === "draft" &&
    lineCount === 0 &&
    !versionZeroSummary?.activeDraft &&
    !versionZeroSummary?.canGenerate &&
    preliminaryStructure.canOpen &&
    !isReadOnlyReview
  ) {
    const preview =
      preliminaryStructure.primarySourceKind === "primary_cctp"
        ? "Ouvrir une preview editable de structure a partir du CCTP principal, sans imposer un import DPGF."
        : preliminaryStructure.sources.length > 1
          ? "Ouvrir une preview editable de structure a partir du brief confirme et des signaux documentaires deja arbitres."
          : "Ouvrir une preview editable de structure a partir du brief confirme.";

    suggestions.push(
      createSuggestion({
        actionId: "generate-structure",
        label: "Ouvrir la structure preliminaire",
        intent: "generate_structure",
        preview,
        target: {
          kind: "navigate",
          href: `/dashboard/estimates/${currentVersion.id}/edit?openStructureDraft=1`,
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

  if (
    registerSummary &&
    registerSummary.revalidationRequired &&
    (registerSummary.revalidationRequiredCount ?? 0) > 0 &&
    !isReadOnlyReview
  ) {
    const isCritical = (registerSummary.criticalRevalidationRequiredCount ?? 0) > 0;
    const count = isCritical
      ? registerSummary.criticalRevalidationRequiredCount ?? 0
      : registerSummary.revalidationRequiredCount ?? 0;
    const impactedStages = describeRevalidationImpactedStages(registerSummary);
    suggestions.push(
      createSuggestion({
        actionId: "review-revalidation",
        label: isCritical
          ? `Relancer ${count} revalidation${count > 1 ? "s" : ""} critique${count > 1 ? "s" : ""}`
          : `Relancer ${count} revalidation${count > 1 ? "s" : ""} ciblee${count > 1 ? "s" : ""}`,
        intent: "list_hypotheses",
        preview: impactedStages
          ? `Un additif ou une piece critique recue tardivement impose une revue ciblee: ${impactedStages}.`
          : "Un additif ou une piece critique recue tardivement impose une revue ciblee avant remise.",
        target: {
          kind: "navigate",
          href: `${buildAffaireRegisterHubHref({
            projectId,
            severity: isCritical ? "critical" : null,
            revalidationRequired: true,
          })}#register`,
        },
        requiresConfirmation: false,
        confirmTone: "warning",
        priority: isCritical ? 735 : 625,
      }),
    );
  }

  if (
    registerSummary &&
    registerSummary.clarifyWithClientCount > 0 &&
    !isReadOnlyReview
  ) {
    const count = registerSummary.clarifyWithClientCount;
    const isCritical = (registerSummary.criticalClarifyWithClientCount ?? 0) > 0;
    const focusEntryId = registerSummary.clarifyWithClientFocusEntryId ?? null;
    suggestions.push(
      createSuggestion({
        actionId: "list-clarifications",
        label: `Traiter ${count} clarification${count !== 1 ? "s" : ""} client`,
        intent: "list_hypotheses",
        preview: isCritical
          ? "Des clarifications critiques restent a porter vers le client avant envoi."
          : "Des clarifications client restent ouvertes dans le registre affaire.",
        target: {
          kind: "navigate",
          href: `${buildAffaireRegisterHubHref({
            projectId,
            status: "clarify_with_client",
            focusEntryId,
          })}#register`,
        },
        requiresConfirmation: false,
        confirmTone: "warning",
        priority: isCritical ? 720 : 610,
      }),
    );
  }

  const openRegisterCount = registerSummary
    ? registerSummary.criticalOpenCount + registerSummary.nonCriticalOpenCount
    : 0;

  if (registerSummary && openRegisterCount > 0 && !isReadOnlyReview) {
    const count = registerSummary.criticalOpenCount > 0
      ? registerSummary.criticalOpenCount
      : openRegisterCount;
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
