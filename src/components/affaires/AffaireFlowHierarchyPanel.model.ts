import {
  isAffaireIntakeDocumentProcessing,
  isAffaireIntakePrimaryEligibleKind,
  resolveAffairePreliminaryStructureCapability,
} from "@/lib/affaires/intake";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import { AFFAIRE_REGISTER_REVALIDATION_IMPACTED_STAGE_LABELS, type AffaireRegisterSummary } from "@/lib/affaires/register";
import type { AffaireHubDpgfSourceResult, AffaireHubFinishLineSummaryResult, AffaireHubSummaryResult } from "@/lib/affaires/server";
import type { CockpitSuggestion } from "@/lib/cockpit/suggestions";
import type { VersionZeroDraftSummary } from "@/lib/estimates/client";

import { resolveSubmissionReadiness } from "./AffairePilotagePanel.logic";
import { getReviewProbableCategories, sortReviewDocuments } from "./AffaireFlowHierarchyPanel.review-logic";
import type { AffaireHubPlansSummaryData } from "./PlansMetresCard";

export type AffaireFlowHierarchyPanelProps = {
  projectId: string;
  hubReadiness?: AffaireHubSummaryResult["hubReadiness"];
  dpgfSource?: AffaireHubDpgfSourceResult;
  currentVersion: AffaireHubSummaryResult["currentVersion"] | null;
  versionZeroSummary?: VersionZeroDraftSummary | null;
  takeoffEnabled?: boolean;
  plansSummary?: AffaireHubPlansSummaryData | null;
  intakeWorkspace?:
    | (Pick<AffaireIntakeWorkspace, "missingPieces" | "documents"> & {
        briefDraft?: AffaireIntakeWorkspace["briefDraft"];
      })
    | null;
  registerSummary?: AffaireRegisterSummary | null;
  finishLineSummary?: AffaireHubFinishLineSummaryResult | null;
  structureMode?: AffaireHubSummaryResult["structureMode"];
  cockpitSuggestions?: CockpitSuggestion[];
  onExecuteSuggestion?: (suggestion: CockpitSuggestion) => void;
};

export type AffaireFlowPanelAction =
  | {
      kind: "suggestion";
      key: string;
      label: string;
      description: string;
      suggestion: CockpitSuggestion;
      variant: "primary" | "secondary" | "ghost";
    }
  | {
      kind: "href";
      key: string;
      label: string;
      description: string;
      href: string;
      variant: "primary" | "secondary" | "ghost";
    };

export type AffaireFlowPanelResultCard =
  | {
      kind: "review";
      title: string;
      message: string;
      readinessStatus?: AffaireFlowPanelModel["readinessLevel"];
      action: AffaireFlowPanelAction;
      facts: string[];
      evidence: string[];
    }
  | {
      kind: "primary";
      title: string;
      message: string;
      readinessStatus?: AffaireFlowPanelModel["readinessLevel"];
      action: AffaireFlowPanelAction | null;
      facts: string[];
      evidence?: string[];
    }
  | {
      kind: "missing";
      title: string;
      message: string;
      readinessStatus?: AffaireFlowPanelModel["readinessLevel"];
      action: AffaireFlowPanelAction;
      facts: string[];
      slotStatus: {
        dpgf: boolean;
        plans: boolean;
        cctp: boolean;
      };
    }
  | {
      kind: "brief" | "structure" | "plans";
      title: string;
      message: string;
      readinessStatus?: AffaireFlowPanelModel["readinessLevel"];
      action: AffaireFlowPanelAction;
      facts: string[];
      evidence?: string[];
    };

export type AffaireFlowPanelModel = {
  heroState: "processing" | "review" | "primary_selection_required" | "missing" | "brief" | "structure" | "plans" | "ready_to_continue";
  reviewImpact?: "critical_missing" | "standard";
  readinessLevel?: "not_ready" | "ready_with_reservations" | "ready";
  title: string;
  summary: string;
  statusLabel: string;
  statusVariant: "success" | "info" | "warning" | "neutral";
  showEmptyUploadCard: boolean;
  resultCard: AffaireFlowPanelResultCard | null;
  primaryAction: AffaireFlowPanelAction | null;
  blockers: string[];
  aides: AffaireFlowPanelAction[];
  legacyAction: AffaireFlowPanelAction | null;
};

function dedupe(values: string[]) {
  return [...new Set(values)];
}

function isHybridStructureAction(action: AffaireFlowPanelAction) {
  return action.label.toLowerCase().includes("hybride");
}

function hasCriticalMissingCategory(missingPieces: NonNullable<AffaireFlowHierarchyPanelProps["intakeWorkspace"]>["missingPieces"], category: string) {
  return missingPieces.some((piece) => piece.severity === "critical" && `${piece.code} ${piece.label}`.toLowerCase().includes(category.toLowerCase()));
}

function hasDetectedDocumentKind(intakeWorkspace: AffaireFlowHierarchyPanelProps["intakeWorkspace"], kind: "dpgf" | "plans" | "cctp") {
  return intakeWorkspace?.documents.some((document) => document.detectedCategory === kind && document.confidence > 0) ?? false;
}

function isDocumentProcessing(document: NonNullable<AffaireFlowHierarchyPanelProps["intakeWorkspace"]>["documents"][number]) {
  return isAffaireIntakeDocumentProcessing(document);
}

function hasOpenCriticalRegisterDocumentRisk(registerSummary: AffaireFlowHierarchyPanelProps["registerSummary"]) {
  if (!registerSummary) {
    return false;
  }

  return registerSummary.criticalOpenCount > 0 && registerSummary.openMissingPieceCount > 0;
}

function hasExplicitMissingPrimary(documents: NonNullable<AffaireFlowHierarchyPanelProps["intakeWorkspace"]>["documents"], category: "dpgf" | "cctp") {
  const docsInCategory = documents.filter((document) => document.detectedCategory === category);
  if (docsInCategory.length < 2) {
    return false;
  }

  return !docsInCategory.some((document) => document.documentPriority === "primary");
}

function formatConfidenceLabel(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}

function ensureDocumentPriorities(documents: NonNullable<AffaireFlowHierarchyPanelProps["intakeWorkspace"]>["documents"]) {
  const hasExplicitPrimary = new Set<string>();

  for (const document of documents) {
    if (isAffaireIntakePrimaryEligibleKind(document.detectedCategory) && document.documentPriority === "primary") {
      hasExplicitPrimary.add(document.detectedCategory);
    }
  }

  const inferredPrimaryByCategory = new Set<string>();

  return documents.map((document) => {
    if (!isAffaireIntakePrimaryEligibleKind(document.detectedCategory)) {
      return {
        ...document,
        documentPriority: document.documentPriority ?? "secondary",
      };
    }

    if (document.documentPriority) {
      return document;
    }

    if (!hasExplicitPrimary.has(document.detectedCategory) && !inferredPrimaryByCategory.has(document.detectedCategory)) {
      inferredPrimaryByCategory.add(document.detectedCategory);
      return {
        ...document,
        documentPriority: "primary" as const,
      };
    }

    return {
      ...document,
      documentPriority: "secondary" as const,
    };
  });
}

function toSuggestionAction(suggestion: CockpitSuggestion, variant: AffaireFlowPanelAction["variant"] = "primary"): AffaireFlowPanelAction {
  return {
    kind: "suggestion",
    key: suggestion.actionId,
    label: suggestion.label,
    description: suggestion.preview,
    suggestion,
    variant,
  };
}

function toHrefAction(input: {
  key: string;
  label: string;
  description: string;
  href: string;
  variant?: AffaireFlowPanelAction["variant"];
}): AffaireFlowPanelAction {
  return {
    kind: "href",
    key: input.key,
    label: input.label,
    description: input.description,
    href: input.href,
    variant: input.variant ?? "secondary",
  };
}

function buildManualEstimateHref(input: { projectId: string; currentVersion: AffaireFlowHierarchyPanelProps["currentVersion"] }) {
  if (input.currentVersion?.status === "draft") {
    return `/dashboard/estimates/${input.currentVersion.id}/edit?entry=manual`;
  }

  return `/dashboard/estimates/new?projectId=${input.projectId}`;
}

function findSuggestion(suggestions: CockpitSuggestion[], intent: CockpitSuggestion["intent"]) {
  return suggestions.find((suggestion) => suggestion.intent === intent) ?? null;
}

function findSuggestionByActionId(suggestions: CockpitSuggestion[], actionId: string) {
  return suggestions.find((suggestion) => suggestion.actionId === actionId) ?? null;
}

function isPreliminaryStructureSuggestion(suggestion: CockpitSuggestion | null) {
  if (!suggestion) {
    return false;
  }

  if (suggestion.label.toLowerCase().includes("structure preliminaire")) {
    return true;
  }

  return suggestion.target.kind === "navigate" && suggestion.target.href.includes("openStructureDraft=1");
}

function isContinueHybridSuggestion(suggestion: CockpitSuggestion | null) {
  if (!suggestion) {
    return false;
  }

  return suggestion.intent === "continue_hybrid" || suggestion.label.toLowerCase().includes("hybride");
}

function isReadyLinkedDpgfSource(dpgfSource: AffaireFlowHierarchyPanelProps["dpgfSource"]) {
  return Boolean(
    dpgfSource &&
    dpgfSource.importStatus === "completed" &&
    (dpgfSource.mappingStatus === null || dpgfSource.mappingStatus === "validated" || dpgfSource.mappingStatus === "applied") &&
    dpgfSource.mappedRowCount > 0,
  );
}

function describePreliminaryStructureContext(intakeWorkspace: AffaireFlowHierarchyPanelProps["intakeWorkspace"]) {
  const briefDraft = intakeWorkspace?.briefDraft ?? null;
  const preliminaryStructure = resolveAffairePreliminaryStructureCapability({
    briefDraft,
    documents: intakeWorkspace?.documents ?? [],
  });
  const readyPrimaryCctp = preliminaryStructure.sources.find((source) => source.kind === "primary_cctp" && source.availability === "ready") ?? null;
  const briefLots = briefDraft?.lots.filter(Boolean) ?? [];

  if (readyPrimaryCctp && briefDraft?.status === "confirme") {
    return {
      title: "Structure preliminaire editable",
      message: "Le brief est confirme. Ouvrez une trame editable du devis a partir du brief et du CCTP principal, sans import DPGF obligatoire.",
      facts: dedupe(["Brief confirme", "CCTP principal detecte", "Sans import DPGF obligatoire"]),
      evidence: dedupe([
        readyPrimaryCctp.fileName ?? "",
        readyPrimaryCctp.availableLots.length > 0 ? `Lots CCTP: ${readyPrimaryCctp.availableLots.slice(0, 2).join(", ")}` : "",
        briefLots.length > 0 ? `Lots brief: ${briefLots.slice(0, 2).join(", ")}` : "",
      ]).filter(Boolean),
    };
  }

  if (readyPrimaryCctp) {
    return {
      title: "Structure preliminaire editable",
      message: "Ouvrez une trame editable du devis a partir du CCTP principal, sans import DPGF obligatoire.",
      facts: dedupe(["CCTP principal detecte", "Sans import DPGF obligatoire"]),
      evidence: dedupe([
        readyPrimaryCctp.fileName ?? "",
        readyPrimaryCctp.availableLots.length > 0 ? `Lots CCTP: ${readyPrimaryCctp.availableLots.slice(0, 2).join(", ")}` : "",
      ]).filter(Boolean),
    };
  }

  return {
    title: "Structure preliminaire editable",
    message: "Le brief confirme permet d'ouvrir une trame editable du devis, sans import DPGF obligatoire.",
    facts: dedupe(["Brief confirme", "Sans import DPGF obligatoire"]),
    evidence: dedupe([briefLots.length > 0 ? `Lots brief: ${briefLots.slice(0, 2).join(", ")}` : ""]).filter(Boolean),
  };
}

function describeStructureMode(structureMode: AffaireFlowHierarchyPanelProps["structureMode"]) {
  if (!structureMode || structureMode.mode === "not_started") {
    return null;
  }

  if (structureMode.mode === "manual") {
    return {
      badgeLabel: "Mode manuel actif",
      facts: [
        `${formatCountLabel(structureMode.manualLineCount, "ligne manuelle", "lignes manuelles")} deja saisie${structureMode.manualLineCount > 1 ? "s" : ""}`,
      ],
    };
  }

  if (structureMode.mode === "imported") {
    return {
      badgeLabel: "Structure importee",
      facts: [`${formatCountLabel(structureMode.importedLineCount, "ligne importee", "lignes importees")} depuis la DPGF`],
    };
  }

  if (structureMode.mode === "hybrid") {
    return {
      badgeLabel: "Mode hybride actif",
      facts: [
        `${formatCountLabel(structureMode.manualLineCount, "ligne manuelle", "lignes manuelles")}`,
        `${formatCountLabel(structureMode.importedLineCount, "ligne importee", "lignes importees")}`,
      ],
    };
  }

  return {
    badgeLabel: "Structure a remettre a jour",
    facts: [
      formatCountLabel(structureMode.lineCount, "ligne déjà saisie", "lignes déjà saisies"),
      structureMode.unsupportedLineCount > 0
        ? `${formatCountLabel(structureMode.unsupportedLineCount, "ligne a revoir", "lignes a revoir")}`
        : "Mode de structure a clarifier",
    ],
  };
}

function formatCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count > 1 ? plural : singular}`;
}

export function buildAffaireFlowPanelModel(input: Readonly<AffaireFlowHierarchyPanelProps>): AffaireFlowPanelModel {
  const suggestions = input.cockpitSuggestions ?? [];
  const documents = ensureDocumentPriorities(input.intakeWorkspace?.documents ?? []);
  const criticalMissingPieces = input.intakeWorkspace?.missingPieces.filter((piece) => piece.severity === "critical") ?? [];
  const missingPieces = input.intakeWorkspace?.missingPieces ?? [];
  const planExceptionCount = input.plansSummary?.exceptionCount ?? 0;
  const submissionReadiness = resolveSubmissionReadiness(input.finishLineSummary);
  const finishLineBlockers = submissionReadiness?.blockers.map((flag) => flag.label) ?? [];
  const documentReadinessFlags = [
    ...(submissionReadiness?.blockers.filter((flag) => flag.category === "documents") ?? []),
    ...(submissionReadiness?.alerts.filter((flag) => flag.category === "documents") ?? []),
  ];
  const documentsCount = documents.length;
  const hasLegacyEntry = input.takeoffEnabled && input.currentVersion !== null && input.plansSummary?.hasLegacyFallback === true;
  const showEmptyUploadCard = documentsCount === 0 && missingPieces.length === 0;
  const processingDocuments = documents.filter((document) => isDocumentProcessing(document));

  const addFilesSuggestion = findSuggestion(suggestions, "add_files");
  const addMissingPiecesSuggestion = findSuggestion(suggestions, "add_missing_pieces");
  const reviewIntakeSuggestion = findSuggestion(suggestions, "review_intake");
  const confirmBriefSuggestion = findSuggestion(suggestions, "confirm_brief");
  const analyzePlansSuggestion = findSuggestion(suggestions, "analyze_plans");
  const generateStructureSuggestion = findSuggestion(suggestions, "generate_structure");
  const continueHybridSuggestion = findSuggestion(suggestions, "continue_hybrid");
  const viewExceptionsSuggestion = findSuggestion(suggestions, "view_exceptions");
  const prepareValidationSuggestion = findSuggestion(suggestions, "prepare_validation");
  const clarificationSuggestion = findSuggestionByActionId(suggestions, "list-clarifications");
  const revalidationSuggestion = findSuggestionByActionId(suggestions, "review-revalidation");
  const linkedDpgfReady = isReadyLinkedDpgfSource(input.dpgfSource);
  const shouldOpenLinkedDpgfAsBase =
    linkedDpgfReady && input.currentVersion?.status === "draft" && (input.structureMode?.mode === "not_started" || input.structureMode == null);
  const needsStructureUpdate = input.structureMode?.mode === "needs_update";
  const canonicalHubReadiness = input.hubReadiness ?? null;
  const canonicalReadinessStatus = canonicalHubReadiness?.status ?? null;
  const allowsCanonicalContinuation = canonicalHubReadiness?.allowsContinuation ?? false;
  const canonicalDrivers = canonicalHubReadiness?.drivers ?? [];

  let title = "Continuer depuis l'affaire";
  let summary = "Le cockpit doit vous mener a la prochaine action utile sans vous disperser.";
  let statusLabel = "Parcours affaire-first";
  let statusVariant: AffaireFlowPanelModel["statusVariant"] = "info";
  let heroState: AffaireFlowPanelModel["heroState"] = "ready_to_continue";
  let reviewImpact: AffaireFlowPanelModel["reviewImpact"] = undefined;
  let readinessLevel: AffaireFlowPanelModel["readinessLevel"] = "not_ready";
  let resultCard: AffaireFlowPanelResultCard | null = null;
  let primaryAction: AffaireFlowPanelAction | null = null;
  const hasDpgf = hasDetectedDocumentKind(input.intakeWorkspace, "dpgf");
  const hasPlans = hasDetectedDocumentKind(input.intakeWorkspace, "plans");
  const hasCctp = hasDetectedDocumentKind(input.intakeWorkspace, "cctp");
  const reviewDocument = sortReviewDocuments(documents, missingPieces)[0] ?? null;
  const briefDraft = input.intakeWorkspace?.briefDraft ?? null;
  const hasMissingPrimaryDpgf = hasExplicitMissingPrimary(documents, "dpgf");
  const hasMissingPrimaryCctp = hasExplicitMissingPrimary(documents, "cctp");
  const hasDocumentReservations = documentReadinessFlags.length > 0 || hasOpenCriticalRegisterDocumentRisk(input.registerSummary);
  const hasCanonicalWorkReservations = canonicalReadinessStatus === "ready_with_reservations";
  const hasWorkReservations = hasDocumentReservations || hasCanonicalWorkReservations;
  const documentReservationFacts = dedupe(documentReadinessFlags.map((flag) => flag.label).slice(0, 2));
  const clarificationCount = input.registerSummary?.clarifyWithClientCount ?? canonicalHubReadiness?.register.clarifyWithClientCount ?? 0;
  const continuationHypothesisCount = input.registerSummary?.continuedWithHypothesisCount ?? canonicalHubReadiness?.register.continuedWithHypothesisCount ?? 0;
  const revalidationCount = input.registerSummary?.revalidationRequiredCount ?? canonicalHubReadiness?.register.revalidationRequiredCount ?? 0;
  const hasClarificationDriver = canonicalDrivers.some((driver) => driver.code === "client_clarification");
  const hasContinuationHypothesisDriver = canonicalDrivers.some((driver) => driver.code === "continued_with_hypothesis");
  const hasRevalidationDriver = canonicalDrivers.some((driver) => driver.code === "revalidation_required");
  const continuationHypothesisFact =
    continuationHypothesisCount > 0
      ? `${formatCountLabel(continuationHypothesisCount, "hypothese de continuation active", "hypotheses de continuation actives")}`
      : "";
  const clarificationFact =
    clarificationCount > 0 ? `${formatCountLabel(clarificationCount, "clarification client ouverte", "clarifications client ouvertes")}` : "";
  const revalidationFacts = (input.registerSummary?.revalidationImpactedStages ?? [])
    .slice(0, 2)
    .map((stage) => AFFAIRE_REGISTER_REVALIDATION_IMPACTED_STAGE_LABELS[stage]);
  const manualEstimateHref = buildManualEstimateHref({
    projectId: input.projectId,
    currentVersion: input.currentVersion,
  });
  const reviewCouldResolveCriticalMissing =
    reviewDocument !== null && getReviewProbableCategories(reviewDocument).some((category) => hasCriticalMissingCategory(missingPieces, category));
  const structureModeDescription = describeStructureMode(input.structureMode);

  if (showEmptyUploadCard) {
    title = "Deposez les pieces pour lancer l'analyse";
    summary = "CCTP, DPGF, plans, courriers.";
    statusLabel = "Affaire neuve";
    statusVariant = "info";
    heroState = "processing";
    readinessLevel = "not_ready";
  } else if (processingDocuments.length > 0 && processingDocuments.length === documentsCount) {
    title = "Analyse en cours";
    summary = "TIMAX classe les pieces et prepare le dossier avant de vous proposer la suite utile.";

    statusLabel = "Analyse en cours";
    statusVariant = "info";
    heroState = "processing";
    readinessLevel = "not_ready";
  } else if (reviewDocument) {
    title = "Vérifier les documents reçus";
    summary = reviewIntakeSuggestion?.preview ?? "Certains documents restent ambigus. Confirmez-les avant de poursuivre.";
    statusLabel = "Documents a confirmer";
    statusVariant = "warning";
    heroState = "review";
    reviewImpact = reviewCouldResolveCriticalMissing ? "critical_missing" : "standard";
    readinessLevel = "not_ready";
    primaryAction = reviewIntakeSuggestion
      ? toSuggestionAction(reviewIntakeSuggestion)
      : toHrefAction({
          key: "review-intake-fallback",
          label: "Confirmer les pieces",
          description: "Ouvrir les pieces a revoir depuis le dossier intake.",
          href: `/dashboard/affaires/${input.projectId}?intakeFilter=a_revoir#intake`,
          variant: "primary",
        });
    resultCard = {
      kind: "review",
      title: "Des pieces sont a revoir",
      message: "Certains documents restent ambigus. Confirmez-les avant de poursuivre.",
      action: primaryAction,
      facts: [reviewIntakeSuggestion ? `${reviewIntakeSuggestion.label.replace("Confirmer ", "")}` : "1 document a confirmer"],
      evidence: dedupe([
        reviewDocument?.fileName ?? "",
        reviewDocument ? `Classification a confirmer (${formatConfidenceLabel(reviewDocument.confidence)})` : "",
        reviewCouldResolveCriticalMissing ? "Peut lever un manque critique" : "",
        reviewDocument?.issues[0] ?? "",
      ]).filter(Boolean),
    };
  } else if (hasMissingPrimaryDpgf || hasMissingPrimaryCctp) {
    const categories = [...(hasMissingPrimaryDpgf ? ["DPGF"] : []), ...(hasMissingPrimaryCctp ? ["CCTP"] : [])];
    title = categories.length === 1 ? `Choisir le ${categories[0]} principal` : "Choisir les documents principaux";
    summary =
      categories.length === 1
        ? `Choisissez le ${categories[0]} de reference avant de lancer les automatismes de production.`
        : "Choisissez les documents de reference avant de lancer les automatismes de production.";
    statusLabel = "Référence principale à définir";
    statusVariant = "warning";
    heroState = "primary_selection_required";
    readinessLevel = "not_ready";
    resultCard = {
      kind: "primary",
      title,
      message: summary,
      action: null,
      facts: [],
      evidence: dedupe([
        hasMissingPrimaryDpgf ? `${documents.filter((document) => document.detectedCategory === "dpgf").length} DPGF detectes` : "",
        hasMissingPrimaryCctp ? `${documents.filter((document) => document.detectedCategory === "cctp").length} CCTP detectes` : "",
        "Analyse et comparaison disponibles tant que le principal n'est pas choisi.",
      ]).filter(Boolean),
    };
  } else if (criticalMissingPieces.length > 0 || missingPieces.length > 0) {
    const count = criticalMissingPieces.length > 0 ? criticalMissingPieces.length : missingPieces.length;
    const missingPiecesAllowContinuation = allowsCanonicalContinuation && canonicalReadinessStatus !== "not_ready";
    title = missingPiecesAllowContinuation ? "Consolider le dossier" : "Compléter le dossier";
    summary = missingPiecesAllowContinuation
      ? criticalMissingPieces.length > 0
        ? `Le dossier peut avancer, mais ${count} piece${count > 1 ? "s" : ""} critique${count > 1 ? "s" : ""} reste${count > 1 ? "nt" : ""} a regulariser pour fiabiliser le metre et la sortie devis.`
        : `Le dossier reste exploitable, mais ${count} piece${count > 1 ? "s" : ""} manque${count > 1 ? "nt" : ""} encore pour fiabiliser le chiffrage.`
      : criticalMissingPieces.length > 0
        ? `Ajoutez d'abord ${count} piece${count > 1 ? "s" : ""} critique${count > 1 ? "s" : ""} avant de lancer le metre ou de finaliser la sortie devis.`
        : `Le dossier reste incomplet. Ajoutez les pieces manquantes avant de poursuivre le chiffrage.`;
    statusLabel = missingPiecesAllowContinuation ? "Sous reserves" : "Dossier incomplet";
    statusVariant = "warning";
    heroState = "missing";
    readinessLevel = canonicalReadinessStatus ?? "not_ready";
    primaryAction = addMissingPiecesSuggestion
      ? toSuggestionAction(addMissingPiecesSuggestion)
      : addFilesSuggestion
        ? toSuggestionAction(addFilesSuggestion)
        : toHrefAction({
            key: "missing-intake-fallback",
            label: "Compléter le dossier",
            description: "Ouvrir l'intake pour ajouter les pieces manquantes.",
            href: `/dashboard/affaires/${input.projectId}#intake`,
            variant: "primary",
          });
    resultCard = {
      kind: "missing",
      title: missingPiecesAllowContinuation ? "Dossier exploitable sous reserves" : "Dossier incomplet",
      message: missingPiecesAllowContinuation
        ? !hasDpgf && !hasPlans
          ? "La base actuelle permet d'avancer, mais la base devis et les plans restent a consolider."
          : !hasDpgf
            ? "Les plans sont presents. Ajoutez la base devis pour fiabiliser la suite du chiffrage."
            : "La base devis est presente. Ajoutez les plans techniques pour fiabiliser la suite."
        : !hasDpgf && !hasPlans
          ? "Il manque la base devis et les plans pour lancer l'analyse."
          : !hasDpgf
            ? "Les plans sont presents, mais il manque encore la base devis."
            : "La base devis est prete, mais il manque encore les plans techniques.",
      readinessStatus: readinessLevel,
      action: primaryAction,
      facts: missingPieces.map((piece) => piece.label).slice(0, 3),
      slotStatus: {
        dpgf: hasDpgf,
        plans: hasPlans,
        cctp: hasCctp,
      },
    };
  } else if (confirmBriefSuggestion || briefDraft?.status === "a_confirmer") {
    title = "Confirmer le brief";
    summary =
      canonicalReadinessStatus === "not_ready"
        ? (confirmBriefSuggestion?.preview ?? "Valider le cadrage du dossier avant de debloquer la suite du chiffrage assiste.")
        : (confirmBriefSuggestion?.preview ?? "Valider le cadrage du dossier pour debloquer la suite du chiffrage assiste.");
    statusLabel = canonicalReadinessStatus === "not_ready" ? "Base insuffisante" : "Brief a valider";
    statusVariant = canonicalReadinessStatus === "not_ready" ? "warning" : "info";
    heroState = "brief";
    readinessLevel = canonicalReadinessStatus ?? "ready_with_reservations";
    primaryAction = confirmBriefSuggestion
      ? toSuggestionAction(confirmBriefSuggestion)
      : toHrefAction({
          key: "confirm-brief-fallback",
          label: "Confirmer le brief",
          description: "Ouvrir le brief affaire pour valider le cadrage metier.",
          href: `/dashboard/affaires/${input.projectId}#brief`,
          variant: "primary",
        });
    resultCard = {
      kind: "brief",
      title: canonicalReadinessStatus === "not_ready" ? "Base de travail insuffisante" : "Dossier exploitable",
      message:
        canonicalReadinessStatus === "not_ready"
          ? "Confirmez le cadrage metier avant de structurer le devis ou de lancer le metre."
          : "Les pieces critiques sont presentes. Confirmez le cadrage metier avant de chiffrer.",
      readinessStatus: readinessLevel,
      action: primaryAction,
      facts: dedupe([hasDpgf ? "DPGF detecte" : "", hasPlans ? "Plans detectes" : "", hasCctp ? "CCTP detecte" : ""]).filter(Boolean),
      evidence: dedupe([
        briefDraft?.projectObject ?? "",
        briefDraft?.lots.length ? `Lots: ${briefDraft.lots.slice(0, 2).join(", ")}` : "",
        briefDraft?.vigilancePoints[0] ? `Point de vigilance: ${briefDraft.vigilancePoints[0]}` : "",
      ]).filter(Boolean),
    };
  } else if (canonicalReadinessStatus === "not_ready") {
    const reviewPending = canonicalHubReadiness?.drivers.some((driver) => driver.code === "review_pending") ?? false;
    const briefPending = canonicalHubReadiness?.drivers.some((driver) => driver.code === "brief_missing" || driver.code === "brief_to_confirm") ?? false;
    const canonicalMissingCount =
      canonicalHubReadiness?.intake.confirmedCriticalMissingPiecesCount || canonicalHubReadiness?.intake.confirmedMissingPiecesCount || 0;

    title = reviewPending
      ? "Vérifier les documents reçus"
      : briefPending
        ? "Confirmer le brief"
        : canonicalMissingCount > 0
          ? "Compléter le dossier"
          : "Stabiliser le dossier";
    summary = reviewPending
      ? (reviewIntakeSuggestion?.preview ?? "Des documents doivent encore etre confirmes avant toute reprise du chiffrage.")
      : briefPending
        ? "Le cadrage metier doit etre valide avant de relancer les automatismes."
        : canonicalMissingCount > 0
          ? `Ajoutez d'abord ${canonicalMissingCount} piece${canonicalMissingCount > 1 ? "s" : ""} manquante${canonicalMissingCount > 1 ? "s" : ""} avant de relancer les automatismes.`
          : "Le backend indique que le dossier n'est pas encore exploitable. Traitez le blocage prioritaire avant de poursuivre.";
    statusLabel = "Base insuffisante";

    statusVariant = "warning";
    heroState = reviewPending ? "review" : briefPending ? "brief" : "missing";
    readinessLevel = "not_ready";
    primaryAction = reviewPending
      ? reviewIntakeSuggestion
        ? toSuggestionAction(reviewIntakeSuggestion)
        : toHrefAction({
            key: "review-intake-fallback",
            label: "Confirmer les pieces",
            description: "Ouvrir les pieces a revoir depuis le dossier intake.",
            href: `/dashboard/affaires/${input.projectId}?intakeFilter=a_revoir#intake`,
            variant: "primary",
          })
      : briefPending
        ? toHrefAction({
            key: "confirm-brief-fallback",
            label: "Confirmer le brief",
            description: "Ouvrir le brief affaire pour valider le cadrage metier.",
            href: `/dashboard/affaires/${input.projectId}#brief`,
            variant: "primary",
          })
        : addMissingPiecesSuggestion
          ? toSuggestionAction(addMissingPiecesSuggestion)
          : addFilesSuggestion
            ? toSuggestionAction(addFilesSuggestion)
            : toHrefAction({
                key: "missing-intake-fallback",
                label: "Compléter le dossier",
                description: "Ouvrir l'intake pour ajouter les pieces manquantes.",
                href: `/dashboard/affaires/${input.projectId}#intake`,
                variant: "primary",
              });
  } else if (hasRevalidationDriver && revalidationSuggestion) {
    title = revalidationSuggestion.label;
    summary = revalidationSuggestion.preview;
    statusLabel = "Revalidation requise";
    statusVariant = "warning";
    heroState = "ready_to_continue";
    readinessLevel = canonicalReadinessStatus ?? "ready_with_reservations";
    primaryAction = toSuggestionAction(revalidationSuggestion);
    resultCard = {
      kind: "primary",
      title: revalidationCount > 1 ? `${revalidationCount} revalidations a relancer` : "Revalidation a relancer",
      message:
        revalidationFacts.length > 0
          ? `Le dossier a change. Relancez d'abord ${revalidationFacts.join(" + ").toLowerCase()} avant de reprendre la remise.`
          : "Le dossier a change. Relancez la revalidation ciblee avant de poursuivre.",
      readinessStatus: readinessLevel,
      action: primaryAction,
      facts: dedupe([formatCountLabel(Math.max(revalidationCount, 1), "revalidation requise", "revalidations requises"), ...revalidationFacts]).filter(Boolean),
      evidence: ["Tracee dans le registre affaire"],
    };
  } else if (hasClarificationDriver && clarificationSuggestion) {
    title = clarificationSuggestion.label;
    summary = clarificationSuggestion.preview;
    statusLabel = "Clarification client requise";
    statusVariant = "warning";
    heroState = "ready_to_continue";
    readinessLevel = canonicalReadinessStatus ?? "ready_with_reservations";
    primaryAction = toSuggestionAction(clarificationSuggestion);
    resultCard = {
      kind: "primary",
      title: clarificationCount > 1 ? `${clarificationCount} clarifications client ouvertes` : "Clarification client ouverte",
      message: "Le dossier reste exploitable, mais un retour client est encore attendu avant la remise.",
      readinessStatus: readinessLevel,
      action: primaryAction,
      facts: dedupe([clarificationFact, continuationHypothesisFact]).filter(Boolean),
      evidence: ["Tracee dans le registre affaire"],
    };
  } else if (continueHybridSuggestion && isContinueHybridSuggestion(continueHybridSuggestion)) {
    const hybridSuggestion = continueHybridSuggestion;
    title = hybridSuggestion.label;
    summary = hybridSuggestion.preview;
    statusLabel = "Mode hybride recommande";
    statusVariant = hasWorkReservations ? "warning" : "info";
    heroState = "structure";
    readinessLevel = input.hubReadiness?.status ?? "ready_with_reservations";
    primaryAction = toSuggestionAction(hybridSuggestion);
    resultCard = {
      kind: "structure",
      title: hasWorkReservations ? "Passage en hybride sous reserves" : "Passage en hybride recommande",
      message: hasWorkReservations
        ? "Le devis existe deja en mode manuel. Importez la DPGF dans cette meme structure pour converger vers un mode hybride, mais le dossier reste sous reserves."
        : "Le devis existe déjà en mode manuel. Importez la DPGF dans cette même structure pour converger vers un mode hybride sans repartir de zéro.",
      readinessStatus: readinessLevel,
      action: primaryAction,
      facts: dedupe([
        structureModeDescription?.badgeLabel ?? "",
        ...(structureModeDescription?.facts ?? []),
        input.structureMode?.linkedDpgfMappedRowCount
          ? `${formatCountLabel(input.structureMode.linkedDpgfMappedRowCount, "ligne DPGF importable", "lignes DPGF importables")}`
          : "",
        clarificationFact,
        continuationHypothesisFact,
        ...(hasWorkReservations ? documentReservationFacts : []),
      ]).filter(Boolean),
      evidence: ["La structure actuelle sera enrichie sans perdre les lignes déjà saisies."],
    };
  } else if (shouldOpenLinkedDpgfAsBase && input.currentVersion && input.dpgfSource) {
    title = "Importer la DPGF";
    summary = "Le DPGF principal est pret. Utilisez-le comme base du devis avant d'ajouter vos completements manuels.";
    statusLabel = "Base importable";
    statusVariant = "info";
    heroState = "structure";
    readinessLevel = input.hubReadiness?.status ?? "ready_with_reservations";
    primaryAction = toHrefAction({
      key: "import-dpgf-base",
      label: "Importer la DPGF",
      description: "Ouvrir le devis pour importer la DPGF liee et materialiser la structure.",
      href: `/dashboard/estimates/${input.currentVersion.id}/edit`,
      variant: "primary",
    });
    resultCard = {
      kind: "structure",
      title: hasWorkReservations ? "Base DPGF importable sous reserves" : "Base DPGF prete a importer",
      message: hasWorkReservations
        ? "La DPGF principale est validee. Importez-la comme base du devis, mais gardez en tete que le dossier reste encore sous reserves."
        : "La DPGF principale est validee. Importez-la comme base du devis pour pre-remplir la structure avant les ajustements manuels.",
      readinessStatus: readinessLevel,
      action: primaryAction,
      facts: dedupe([
        "DPGF principal valide",
        input.dpgfSource.mappedRowCount > 0 ? `${formatCountLabel(input.dpgfSource.mappedRowCount, "ligne importable", "lignes importables")}` : "",
        ...(hasWorkReservations ? documentReservationFacts : []),
      ]).filter(Boolean),
      evidence: dedupe([input.dpgfSource.filename, input.dpgfSource.mappingStatus === "applied" ? "Mapping déjà appliqué" : "Mapping valide"]).filter(Boolean),
    };
  } else if (planExceptionCount > 0 && viewExceptionsSuggestion) {
    title = "Traiter les ecarts de preuves";
    summary = viewExceptionsSuggestion.preview;
    statusLabel = "Revue requise";
    statusVariant = "warning";
    heroState = "plans";
    readinessLevel = "ready_with_reservations";
    primaryAction = toSuggestionAction(viewExceptionsSuggestion);
  } else if (analyzePlansSuggestion) {
    title = "Lancer le metre";
    summary = analyzePlansSuggestion.preview;
    statusLabel = hasWorkReservations ? "Analyse sous reserves" : "Pret pour analyse";
    statusVariant = hasWorkReservations ? "warning" : "success";
    heroState = "plans";
    readinessLevel = input.hubReadiness?.status ?? (hasDocumentReservations ? "ready_with_reservations" : "ready");
    primaryAction = toSuggestionAction(analyzePlansSuggestion);
    resultCard = {
      kind: "plans",
      title: hasWorkReservations ? "Structure disponible sous reserves" : "Structure prete",
      message: hasWorkReservations
        ? hasContinuationHypothesisDriver && !hasDocumentReservations
          ? "Lancez l'analyse des plans en gardant la trace d'hypothese active dans le registre."
          : "Lancez l'analyse des plans, mais le dossier reste incomplet."
        : "Lancez l'analyse des plans pour extraire les quantites.",
      readinessStatus: readinessLevel,
      action: primaryAction,
      facts: dedupe([
        structureModeDescription?.badgeLabel ?? "",
        clarificationFact,
        continuationHypothesisFact,
        hasPlans ? "Plans detectes" : "",
        hasDpgf ? (hasWorkReservations ? "Base devis disponible sous reserves" : "Base devis prete") : "",
        ...documentReservationFacts,
      ]).filter(Boolean),
    };
  } else if (generateStructureSuggestion) {
    const hasStructureDraft = generateStructureSuggestion.label.toLowerCase().includes("revoir");
    const isPreliminaryStructure = isPreliminaryStructureSuggestion(generateStructureSuggestion);
    const preliminaryContext = isPreliminaryStructure ? describePreliminaryStructureContext(input.intakeWorkspace) : null;
    title = generateStructureSuggestion.label;
    summary = generateStructureSuggestion.preview;
    statusLabel = needsStructureUpdate
      ? "Structure a remettre a jour"
      : hasStructureDraft
        ? "Structure a reprendre"
        : isPreliminaryStructure
          ? "Structure preliminaire"
          : "Structure à générer";
    statusVariant = hasWorkReservations ? "warning" : "success";
    heroState = "structure";
    readinessLevel = input.hubReadiness?.status ?? "ready_with_reservations";
    primaryAction = toSuggestionAction(generateStructureSuggestion);
    resultCard = {
      kind: "structure",
      title: isPreliminaryStructure
        ? hasWorkReservations
          ? "Structure preliminaire sous reserves"
          : (preliminaryContext?.title ?? "Structure preliminaire editable")
        : needsStructureUpdate
          ? hasWorkReservations
            ? "Structure a remettre a jour sous reserves"
            : "Structure a remettre a jour"
          : hasWorkReservations
            ? "Structure generable sous reserves"
            : "Brief confirme",
      message: hasStructureDraft
        ? hasWorkReservations
          ? hasContinuationHypothesisDriver && !hasDocumentReservations
            ? "Le brief est confirme. Reprenez la structure du devis en gardant la trace d'hypothese active."
            : "Le brief est confirme. Reprenez la structure du devis, mais le dossier reste incomplet."
          : "Le brief est confirme. Reprenez la structure du devis avant de materialiser le chiffrage."
        : needsStructureUpdate
          ? hasWorkReservations
            ? "Le devis contient déjà une trame, mais certaines lignes doivent être revues avant de poursuivre le chiffrage. Le dossier reste sous reserves."
            : "Le devis contient déjà une trame, mais certaines lignes doivent être revues avant de poursuivre le chiffrage."
          : isPreliminaryStructure
            ? hasWorkReservations
              ? `${preliminaryContext?.message ?? "La structure preliminaire reste disponible."} Le dossier reste toutefois sous reserves.`
              : (preliminaryContext?.message ?? "Le brief confirme suffit pour ouvrir une structure preliminaire editable.")
            : hasWorkReservations
              ? hasContinuationHypothesisDriver && !hasDocumentReservations
                ? "Le brief est confirme. Generez la structure du devis en gardant la trace d'hypothese active."
                : "Le brief est confirme. Generez la structure du devis, mais le dossier reste incomplet."
              : "Le brief est confirme. Generez la structure du devis pour lancer le chiffrage.",
      readinessStatus: readinessLevel,
      action: primaryAction,
      facts: isPreliminaryStructure
        ? dedupe([
            structureModeDescription?.badgeLabel ?? "",
            clarificationFact,
            continuationHypothesisFact,
            ...(preliminaryContext?.facts ?? []),
            ...(hasWorkReservations ? documentReservationFacts : []),
          ]).filter(Boolean)
        : dedupe([
            structureModeDescription?.badgeLabel ?? "",
            ...(structureModeDescription?.facts ?? []),
            clarificationFact,
            continuationHypothesisFact,
            hasDpgf ? (hasWorkReservations ? "Base devis disponible sous reserves" : "Base devis prete") : "",
            hasPlans ? "Plans detectes" : "",
            ...(hasWorkReservations ? documentReservationFacts : ["Version brouillon disponible"]),
          ]).filter(Boolean),
      evidence: isPreliminaryStructure ? (preliminaryContext?.evidence ?? []) : undefined,
    };
  } else if (prepareValidationSuggestion) {
    title = "Preparer la validation";
    summary = prepareValidationSuggestion.preview;
    statusLabel = "Pret pour validation";
    statusVariant = "success";
    heroState = "ready_to_continue";
    readinessLevel = "ready_with_reservations";
    primaryAction = toSuggestionAction(prepareValidationSuggestion);
  } else if (submissionReadiness && (submissionReadiness.status === "ready" || submissionReadiness.status === "warning")) {
    title = "Vérifier la sortie devis";
    summary = "Le chiffrage est assez stable pour vérifier le PDF, l'email et la sortie client.";
    statusLabel = "Sortie a finaliser";
    statusVariant = "success";
    heroState = "ready_to_continue";
    readinessLevel = submissionReadiness.status === "ready" ? "ready" : "ready_with_reservations";
    primaryAction = toHrefAction({
      key: "finish-line-output",
      label: "Ouvrir la sortie devis",
      description: "Vérifier le PDF, l'email et les derniers points avant envoi.",
      href: "#finish-line-output",
      variant: "primary",
    });
  } else if (input.takeoffEnabled && (input.plansSummary?.planSetCount ?? 0) > 0) {
    title = "Ouvrir les plans";
    summary = "Les plans sont disponibles. Continuez le parcours affaire-first depuis cette surface.";
    statusLabel = "Pret pour metre";
    statusVariant = "info";
    heroState = "ready_to_continue";
    readinessLevel = "ready_with_reservations";
    primaryAction = toHrefAction({
      key: "plans",
      label: "Ouvrir les plans",
      description: "Continuer le parcours affaire-first depuis les plans.",
      href: `/dashboard/affaires/${input.projectId}/plans`,
      variant: "primary",
    });
  }

  const blockers = showEmptyUploadCard
    ? []
    : dedupe([
        ...(heroState === "review" || heroState === "missing" || heroState === "primary_selection_required"
          ? []
          : criticalMissingPieces.map((piece) => piece.label)),
        ...(planExceptionCount > 0
          ? [`${planExceptionCount} ecart${planExceptionCount > 1 ? "s" : ""} majeur${planExceptionCount > 1 ? "s" : ""} sur les metres`]
          : []),
        ...finishLineBlockers,
      ]).slice(0, 3);

  const hasDominantRegisterAction =
    primaryAction?.kind === "suggestion" && (primaryAction.key === "review-revalidation" || primaryAction.key === "list-clarifications");
  const hasHybridPrimaryAction = primaryAction ? isHybridStructureAction(primaryAction) : false;
  const allowSecondaryAides = heroState === "ready_to_continue" && !hasDominantRegisterAction;
  const aides: AffaireFlowPanelAction[] = [];
  if ((allowSecondaryAides || heroState === "structure") && manualEstimateHref && primaryAction?.key !== "manual-estimate" && !hasHybridPrimaryAction) {
    aides.push(
      toHrefAction({
        key: "manual-estimate",
        label: "Continuer en manuel",
        description: "Ouvrir le devis sans attendre un import DPGF. Vous pourrez compléter ou hybrider plus tard.",
        href: manualEstimateHref,
        variant: "ghost",
      }),
    );
  }
  if (allowSecondaryAides && clarificationSuggestion && primaryAction?.key !== clarificationSuggestion.actionId) {
    aides.push(toSuggestionAction(clarificationSuggestion, "ghost"));
  }
  if (allowSecondaryAides && generateStructureSuggestion && primaryAction?.key !== generateStructureSuggestion.actionId) {
    aides.push(toSuggestionAction(generateStructureSuggestion, "ghost"));
  } else if (
    allowSecondaryAides &&
    input.currentVersion?.status === "draft" &&
    (input.versionZeroSummary?.activeDraft || input.versionZeroSummary?.canGenerate)
  ) {
    aides.push(
      toHrefAction({
        key: "version-zero",
        label: input.versionZeroSummary?.activeDraft ? "Revoir V0 IA" : "Ouvrir V0 IA",
        description: "Utiliser la V0 IA comme aide de structuration, sans quitter le parcours affaire-first.",
        href: `/dashboard/estimates/${input.currentVersion.id}/edit?openVersionZero=1`,
        variant: "ghost",
      }),
    );
  }

  if (allowSecondaryAides && analyzePlansSuggestion && primaryAction?.key !== analyzePlansSuggestion.actionId) {
    aides.push(toSuggestionAction(analyzePlansSuggestion, "ghost"));
  } else if (allowSecondaryAides && input.takeoffEnabled && primaryAction?.key !== "plans" && (input.plansSummary?.planSetCount ?? 0) > 0) {
    aides.push(
      toHrefAction({
        key: "open-plans",
        label: "Ouvrir les plans",
        description: "Vérifier le jeu de plans retenu avant analyse ou revue.",
        href: `/dashboard/affaires/${input.projectId}/plans`,
        variant: "ghost",
      }),
    );
  }

  const legacyAction = hasLegacyEntry
    ? toHrefAction({
        key: "legacy-fallback",
        label: "Ouvrir le fallback legacy",
        description: `Un contexte estimate-first existe deja sur la V${input.currentVersion?.versionNumber ?? "?"}. Utilisez-le seulement comme reprise exceptionnelle.`,
        href: `/dashboard/estimates/${input.currentVersion?.id}/takeoff`,
        variant: "secondary",
      })
    : null;

  return {
    heroState,
    reviewImpact,
    readinessLevel,
    title,
    summary,
    statusLabel,
    statusVariant,
    showEmptyUploadCard,
    resultCard,
    primaryAction,
    blockers,
    aides,
    legacyAction,
  };
}
