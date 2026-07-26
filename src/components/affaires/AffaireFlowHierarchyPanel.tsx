"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { reclassifyAffaireDocument } from "@/app/dashboard/affaires/_actions/intake";
import { Badge } from "@/components/ui/Badge";
import { Popover } from "@/components/ui/Popover";
import {
  AFFAIRE_INTAKE_DOCUMENT_PRIORITY_LABELS,
  isAffaireIntakePrimaryEligibleKind,
  isAffaireIntakeDocumentNeedingReview,
  isAffaireIntakeDocumentProcessing,
  resolveAffairePreliminaryStructureCapability,
} from "@/lib/affaires/intake";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import {
  AFFAIRE_REGISTER_REVALIDATION_IMPACTED_STAGE_LABELS,
  type AffaireRegisterSummary,
} from "@/lib/affaires/register";
import type {
  AffaireHubDpgfSourceResult,
  AffaireHubFinishLineSummaryResult,
  AffaireHubSummaryResult,
} from "@/lib/affaires/server";
import type { CockpitSuggestion } from "@/lib/cockpit/suggestions";
import { dispatchCockpitOpenSurface } from "@/lib/cockpit/events";
import type { VersionZeroDraftSummary } from "@/lib/estimates/client";

import type { AffaireHubPlansSummaryData } from "./PlansMetresCard";
import { resolveSubmissionReadiness } from "./AffairePilotagePanel.logic";
import {
  getCategoryIllustrationLabel,
  getFileIllustrationTone,
  getReviewChoiceConsequence,
  getReviewChoiceLabel,
  getReviewChoiceSecondaryBadge,
  getReviewEvidenceHints,
  getReviewProbableCategories,
  sortReviewDocuments,
} from "./AffaireFlowHierarchyPanel.review-logic";
import { IntakeCategoryCard, categorySort } from "./IntakeCategoryCard";
import { IntakeDocumentCard } from "./IntakeDocumentCard";

type AffaireFlowHierarchyPanelProps = {
  projectId: string;
  hubReadiness?: AffaireHubSummaryResult["hubReadiness"];
  dpgfSource?: AffaireHubDpgfSourceResult;
  currentVersion: AffaireHubSummaryResult["currentVersion"] | null;
  versionZeroSummary?: VersionZeroDraftSummary | null;
  takeoffEnabled?: boolean;
  plansSummary?: AffaireHubPlansSummaryData | null;
  intakeWorkspace?: (Pick<AffaireIntakeWorkspace, "missingPieces" | "documents"> & {
    briefDraft?: AffaireIntakeWorkspace["briefDraft"];
  }) | null;
  registerSummary?: AffaireRegisterSummary | null;
  finishLineSummary?: AffaireHubFinishLineSummaryResult | null;
  structureMode?: AffaireHubSummaryResult["structureMode"];
  cockpitSuggestions?: CockpitSuggestion[];
  onExecuteSuggestion?: (suggestion: CockpitSuggestion) => void;
};

type PanelAction =
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

type PanelResultCard =
  | {
      kind: "review";
      title: string;
      message: string;
      readinessStatus?: PanelModel["readinessLevel"];
      action: PanelAction;
      facts: string[];
      evidence: string[];
    }
  | {
      kind: "primary";
      title: string;
      message: string;
      readinessStatus?: PanelModel["readinessLevel"];
      action: PanelAction | null;
      facts: string[];
      evidence?: string[];
    }
  | {
      kind: "missing";
      title: string;
      message: string;
      readinessStatus?: PanelModel["readinessLevel"];
      action: PanelAction;
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
      readinessStatus?: PanelModel["readinessLevel"];
      action: PanelAction;
      facts: string[];
      evidence?: string[];
    };

type PanelModel = {
  heroState:
    | "processing"
    | "review"
    | "primary_selection_required"
    | "missing"
    | "brief"
    | "structure"
    | "plans"
    | "ready_to_continue";
  reviewImpact?: "critical_missing" | "standard";
  readinessLevel?: "not_ready" | "ready_with_reservations" | "ready";
  title: string;
  summary: string;
  statusLabel: string;
  statusVariant: "success" | "info" | "warning" | "neutral";
  showEmptyUploadCard: boolean;
  resultCard: PanelResultCard | null;
  primaryAction: PanelAction | null;
  blockers: string[];
  aides: PanelAction[];
  legacyAction: PanelAction | null;
};

type IllustrationItem = {
  key: string;
  title: string;
  subtitle: string;
  label: string;
  accent: string;
  frame: string;
  isMissing: boolean;
  representedCount?: number;
  severityLabel?: string | null;
  severityToneClassName?: string | null;
};

const MAX_HERO_VALIDATED_ITEMS = 2;
const MAX_HERO_MISSING_ITEMS = 2;

function getActionClassName(variant: PanelAction["variant"]) {
  if (variant === "primary") {
    return "btn btn-primary btn-sm";
  }

  if (variant === "secondary") {
    return "btn btn-secondary btn-sm";
  }

  return "btn btn-ghost btn-sm";
}

function getHubReadinessBadge(input: {
  hubReadiness: AffaireHubSummaryResult["hubReadiness"];
  fallback: PanelModel["readinessLevel"];
}) {
  const status = input.hubReadiness?.status ?? input.fallback ?? "not_ready";

  if (status === "ready") {
    return {
      label: "Base de travail prete",
      variant: "success" as const,
    };
  }

  if (status === "ready_with_reservations") {
    return {
      label: "Avancer sous reserves",
      variant: "warning" as const,
    };
  }

  return {
    label: "Base de travail insuffisante",
    variant: "warning" as const,
  };
}

function dedupe(values: string[]) {
  return [...new Set(values)];
}

function isStructureResumeAction(action: PanelAction) {
  const label = action.label.toLowerCase();
  return label.includes("revoir") || label.includes("reprendre");
}

function isHybridStructureAction(action: PanelAction) {
  return action.label.toLowerCase().includes("hybride");
}

function isDpgfImportStructureAction(action: PanelAction) {
  return action.label.toLowerCase().includes("dpgf");
}

function hasCriticalMissingCategory(
  missingPieces: NonNullable<AffaireFlowHierarchyPanelProps["intakeWorkspace"]>["missingPieces"],
  category: string,
) {
  return missingPieces.some(
    (piece) =>
      piece.severity === "critical" &&
      `${piece.code} ${piece.label}`.toLowerCase().includes(category.toLowerCase()),
  );
}

function hasDetectedDocumentKind(
  intakeWorkspace: AffaireFlowHierarchyPanelProps["intakeWorkspace"],
  kind: "dpgf" | "plans" | "cctp",
) {
  return (
    intakeWorkspace?.documents.some(
      (document) => document.detectedCategory === kind && document.confidence > 0,
    ) ?? false
  );
}

function isDocumentProcessing(
  document: NonNullable<AffaireFlowHierarchyPanelProps["intakeWorkspace"]>["documents"][number],
) {
  return isAffaireIntakeDocumentProcessing(document);
}

function isDocumentNeedingReview(
  document: NonNullable<AffaireFlowHierarchyPanelProps["intakeWorkspace"]>["documents"][number],
) {
  return isAffaireIntakeDocumentNeedingReview(document);
}

function hasOpenCriticalRegisterDocumentRisk(
  registerSummary: AffaireFlowHierarchyPanelProps["registerSummary"],
) {
  if (!registerSummary) {
    return false;
  }

  return (
    registerSummary.criticalOpenCount > 0 &&
    registerSummary.openMissingPieceCount > 0
  );
}

function hasExplicitMissingPrimary(
  documents: NonNullable<AffaireFlowHierarchyPanelProps["intakeWorkspace"]>["documents"],
  category: "dpgf" | "cctp",
) {
  const docsInCategory = documents.filter((document) => document.detectedCategory === category);
  if (docsInCategory.length < 2) {
    return false;
  }

  return !docsInCategory.some((document) => document.documentPriority === "primary");
}

function formatConfidenceLabel(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}

function getMissingPieceSeverityLabel(severity: "critical" | "warning" | "info") {
  return severity === "critical" ? "Critique" : "Attention";
}

function buildMissingIllustrationItem(
  piece: NonNullable<AffaireFlowHierarchyPanelProps["intakeWorkspace"]>["missingPieces"][number],
  mode: "missing" | "review_context" = "missing",
): IllustrationItem {
  const normalizedLabel = piece.label.toLowerCase();
  const title = normalizedLabel.includes("plans")
    ? "Plans"
    : normalizedLabel.includes("dpgf")
      ? "DPGF"
      : normalizedLabel.includes("cctp")
        ? "CCTP"
        : piece.label.replace(/ manquant(?:es?)?/i, "");
  const label = normalizedLabel.includes("plans")
    ? mode === "review_context"
      ? "PLANS NON DETECTES"
      : "PLAN MANQUANT"
    : normalizedLabel.includes("dpgf")
      ? mode === "review_context"
        ? "DPGF NON DETECTE"
        : "DPGF MANQUANT"
      : normalizedLabel.includes("cctp")
        ? mode === "review_context"
          ? "CCTP NON DETECTE"
          : "CCTP MANQUANT"
        : mode === "review_context"
          ? "DOC NON DETECTE"
          : "DOC MANQUANT";

  return {
    key: `missing-${title.toLowerCase()}`,
    title,
    subtitle: "",
    label,
    accent: "text-slate-400",
    frame: "border-dashed border-slate-300 bg-white/70",
    isMissing: true,
    representedCount: 1,
    severityLabel: getMissingPieceSeverityLabel(piece.severity),
    severityToneClassName:
      piece.severity === "critical"
        ? "border-danger/20 bg-danger/8 text-danger"
        : "border-amber-300/70 bg-amber-100 text-amber-800",
  };
}

function buildValidatedIllustrationItem(
  document: NonNullable<AffaireFlowHierarchyPanelProps["intakeWorkspace"]>["documents"][number],
): IllustrationItem {
  const isPrimaryEligible = isAffaireIntakePrimaryEligibleKind(document.detectedCategory);
  const priority = document.documentPriority ?? "secondary";
  const categoryLabel = getCategoryIllustrationLabel(document.detectedCategory);
  const label = isPrimaryEligible
    ? `${categoryLabel.toUpperCase()} ${AFFAIRE_INTAKE_DOCUMENT_PRIORITY_LABELS[priority].toUpperCase()}`
    : `${categoryLabel.toUpperCase()} VALIDE`;

  return {
    key: `validated-${document.documentId}`,
    title: document.fileName,
    subtitle: isPrimaryEligible
      ? `${categoryLabel} ${AFFAIRE_INTAKE_DOCUMENT_PRIORITY_LABELS[priority].toLowerCase()}`
      : categoryLabel,
    label,
    accent: "text-emerald-700",
    frame: "border-emerald-200 bg-emerald-50/90",
    isMissing: false,
    representedCount: 1,
  };
}

function buildComplementarySummaryIllustrationItem(input: {
  category: "dpgf" | "cctp";
  count: number;
}): IllustrationItem {
  const categoryLabel = getCategoryIllustrationLabel(input.category);

  return {
    key: `secondary-${input.category}`,
    title: `Autres ${categoryLabel} (${input.count})`,
    subtitle: `${input.count} document${input.count > 1 ? "s" : ""} complementaire${input.count > 1 ? "s" : ""}`,
    label: `${categoryLabel.toUpperCase()} COMPLEMENTAIRE`,
    accent: "text-emerald-700",
    frame: "border-emerald-200 bg-emerald-50/90",
    isMissing: false,
    representedCount: input.count,
  };
}

function buildMissingPrimaryIllustrationItem(input: {
  category: "dpgf" | "cctp";
  count: number;
}): IllustrationItem {
  const categoryLabel = getCategoryIllustrationLabel(input.category);

  return {
    key: `missing-primary-${input.category}`,
    title: `${input.count} ${categoryLabel}`,
    subtitle: "Principal a definir",
    label: `${categoryLabel.toUpperCase()} SANS PRINCIPAL`,
    accent: "text-amber-800",
    frame: "border-amber-200 bg-amber-50/90",
    isMissing: false,
    representedCount: 0,
  };
}

function buildReviewOverflowIllustrationItem(count: number): IllustrationItem {
  return {
    key: "review-overflow",
    title: `Autres pieces a confirmer (${count})`,
    subtitle: `${count} document${count > 1 ? "s" : ""} restent a classer`,
    label: "AUTRES A CONFIRMER",
    accent: "text-amber-800",
    frame: "border-amber-200 bg-amber-50/90",
    isMissing: false,
    representedCount: count,
  };
}

function buildValidatedOverflowIllustrationItem(count: number): IllustrationItem {
  const noun = count > 1 ? "documents" : "document";
  const verb = count > 1 ? "restent" : "reste";
  const adjective = count > 1 ? "disponibles" : "disponible";
  return {
    key: "validated-overflow",
    title: `Autres valides (${count})`,
    subtitle: `${count} ${noun} ${verb} ${adjective} dans le dossier`,
    label: "AUTRES VALIDES",
    accent: "text-emerald-700",
    frame: "border-emerald-200 bg-emerald-50/90",
    isMissing: false,
    representedCount: count,
  };
}

function buildMissingOverflowIllustrationItem(count: number): IllustrationItem {
  const noun = count > 1 ? "pieces" : "piece";
  const verb = count > 1 ? "restent" : "reste";
  return {
    key: "missing-overflow",
    title: `Autres manquants (${count})`,
    subtitle: `${count} ${noun} ${verb} a ajouter`,
    label: "AUTRES MANQUANTS",
    accent: "text-amber-800",
    frame: "border-amber-200 bg-amber-50/90",
    isMissing: true,
    representedCount: count,
  };
}

function ensureDocumentPriorities(
  documents: NonNullable<AffaireFlowHierarchyPanelProps["intakeWorkspace"]>["documents"],
) {
  const hasExplicitPrimary = new Set<string>();

  for (const document of documents) {
    if (
      isAffaireIntakePrimaryEligibleKind(document.detectedCategory) &&
      document.documentPriority === "primary"
    ) {
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

    if (
      !hasExplicitPrimary.has(document.detectedCategory) &&
      !inferredPrimaryByCategory.has(document.detectedCategory)
    ) {
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

function toSuggestionAction(
  suggestion: CockpitSuggestion,
  variant: PanelAction["variant"] = "primary",
): PanelAction {
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
  variant?: PanelAction["variant"];
}): PanelAction {
  return {
    kind: "href",
    key: input.key,
    label: input.label,
    description: input.description,
    href: input.href,
    variant: input.variant ?? "secondary",
  };
}

function buildManualEstimateHref(input: {
  projectId: string;
  currentVersion: AffaireFlowHierarchyPanelProps["currentVersion"];
}) {
  if (input.currentVersion?.status === "draft") {
    return `/dashboard/estimates/${input.currentVersion.id}/edit?entry=manual`;
  }

  return `/dashboard/estimates/new?projectId=${input.projectId}`;
}

function findSuggestion(
  suggestions: CockpitSuggestion[],
  intent: CockpitSuggestion["intent"],
) {
  return suggestions.find((suggestion) => suggestion.intent === intent) ?? null;
}

function findSuggestionByActionId(
  suggestions: CockpitSuggestion[],
  actionId: string,
) {
  return suggestions.find((suggestion) => suggestion.actionId === actionId) ?? null;
}

function isPreliminaryStructureSuggestion(suggestion: CockpitSuggestion | null) {
  if (!suggestion) {
    return false;
  }

  if (suggestion.label.toLowerCase().includes("structure preliminaire")) {
    return true;
  }

  return (
    suggestion.target.kind === "navigate" &&
    suggestion.target.href.includes("openStructureDraft=1")
  );
}

function isContinueHybridSuggestion(suggestion: CockpitSuggestion | null) {
  if (!suggestion) {
    return false;
  }

  return suggestion.intent === "continue_hybrid" || suggestion.label.toLowerCase().includes("hybride");
}

function isReadyLinkedDpgfSource(
  dpgfSource: AffaireFlowHierarchyPanelProps["dpgfSource"],
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

function describePreliminaryStructureContext(
  intakeWorkspace: AffaireFlowHierarchyPanelProps["intakeWorkspace"],
) {
  const briefDraft = intakeWorkspace?.briefDraft ?? null;
  const preliminaryStructure = resolveAffairePreliminaryStructureCapability({
    briefDraft,
    documents: intakeWorkspace?.documents ?? [],
  });
  const readyPrimaryCctp =
    preliminaryStructure.sources.find(
      (source) => source.kind === "primary_cctp" && source.availability === "ready",
    ) ?? null;
  const briefLots = briefDraft?.lots.filter(Boolean) ?? [];

  if (readyPrimaryCctp && briefDraft?.status === "confirme") {
    return {
      title: "Structure preliminaire editable",
      message:
        "Le brief est confirme. Ouvrez une trame editable du devis a partir du brief et du CCTP principal, sans import DPGF obligatoire.",
      facts: dedupe([
        "Brief confirme",
        "CCTP principal detecte",
        "Sans import DPGF obligatoire",
      ]),
      evidence: dedupe([
        readyPrimaryCctp.fileName ?? "",
        readyPrimaryCctp.availableLots.length > 0
          ? `Lots CCTP: ${readyPrimaryCctp.availableLots.slice(0, 2).join(", ")}`
          : "",
        briefLots.length > 0 ? `Lots brief: ${briefLots.slice(0, 2).join(", ")}` : "",
      ]).filter(Boolean),
    };
  }

  if (readyPrimaryCctp) {
    return {
      title: "Structure preliminaire editable",
      message:
        "Ouvrez une trame editable du devis a partir du CCTP principal, sans import DPGF obligatoire.",
      facts: dedupe(["CCTP principal detecte", "Sans import DPGF obligatoire"]),
      evidence: dedupe([
        readyPrimaryCctp.fileName ?? "",
        readyPrimaryCctp.availableLots.length > 0
          ? `Lots CCTP: ${readyPrimaryCctp.availableLots.slice(0, 2).join(", ")}`
          : "",
      ]).filter(Boolean),
    };
  }

  return {
    title: "Structure preliminaire editable",
    message:
      "Le brief confirme permet d'ouvrir une trame editable du devis, sans import DPGF obligatoire.",
    facts: dedupe(["Brief confirme", "Sans import DPGF obligatoire"]),
    evidence: dedupe([
      briefLots.length > 0 ? `Lots brief: ${briefLots.slice(0, 2).join(", ")}` : "",
    ]).filter(Boolean),
  };
}

function describeStructureMode(
  structureMode: AffaireFlowHierarchyPanelProps["structureMode"],
) {
  if (!structureMode || structureMode.mode === "not_started") {
    return null;
  }

  if (structureMode.mode === "manual") {
    return {
      badgeLabel: "Mode manuel actif",
      facts: [
        `${formatCountLabel(
          structureMode.manualLineCount,
          "ligne manuelle",
          "lignes manuelles",
        )} deja saisie${structureMode.manualLineCount > 1 ? "s" : ""}`,
      ],
    };
  }

  if (structureMode.mode === "imported") {
    return {
      badgeLabel: "Structure importee",
      facts: [
        `${formatCountLabel(
          structureMode.importedLineCount,
          "ligne importee",
          "lignes importees",
        )} depuis la DPGF`,
      ],
    };
  }

  if (structureMode.mode === "hybrid") {
    return {
      badgeLabel: "Mode hybride actif",
      facts: [
        `${formatCountLabel(
          structureMode.manualLineCount,
          "ligne manuelle",
          "lignes manuelles",
        )}`,
        `${formatCountLabel(
          structureMode.importedLineCount,
          "ligne importee",
          "lignes importees",
        )}`,
      ],
    };
  }

  return {
    badgeLabel: "Structure a remettre a jour",
    facts: [
      formatCountLabel(
        structureMode.lineCount,
        "ligne déjà saisie",
        "lignes déjà saisies",
      ),
      structureMode.unsupportedLineCount > 0
        ? `${formatCountLabel(
            structureMode.unsupportedLineCount,
            "ligne a revoir",
            "lignes a revoir",
          )}`
        : "Mode de structure a clarifier",
    ],
  };
}

function formatCountLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
) {
  return `${count} ${count > 1 ? plural : singular}`;
}

function buildPanelModel(
  input: Readonly<AffaireFlowHierarchyPanelProps>,
): PanelModel {
  const suggestions = input.cockpitSuggestions ?? [];
  const documents = ensureDocumentPriorities(input.intakeWorkspace?.documents ?? []);
  const criticalMissingPieces =
    input.intakeWorkspace?.missingPieces.filter((piece) => piece.severity === "critical") ?? [];
  const missingPieces = input.intakeWorkspace?.missingPieces ?? [];
  const planExceptionCount = input.plansSummary?.exceptionCount ?? 0;
  const submissionReadiness = resolveSubmissionReadiness(input.finishLineSummary);
  const finishLineBlockers = submissionReadiness?.blockers.map((flag) => flag.label) ?? [];
  const documentReadinessFlags = [
    ...(submissionReadiness?.blockers.filter(
      (flag) => flag.category === "documents",
    ) ?? []),
    ...(submissionReadiness?.alerts.filter(
      (flag) => flag.category === "documents",
    ) ?? []),
  ];
  const documentsCount = documents.length;
  const hasLegacyEntry =
    input.takeoffEnabled &&
    input.currentVersion !== null &&
    input.plansSummary?.hasLegacyFallback === true;
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
  const clarificationSuggestion = findSuggestionByActionId(
    suggestions,
    "list-clarifications",
  );
  const revalidationSuggestion = findSuggestionByActionId(
    suggestions,
    "review-revalidation",
  );
  const linkedDpgfReady = isReadyLinkedDpgfSource(input.dpgfSource);
  const shouldOpenLinkedDpgfAsBase =
    linkedDpgfReady &&
    input.currentVersion?.status === "draft" &&
    (input.structureMode?.mode === "not_started" || input.structureMode == null);
  const needsStructureUpdate = input.structureMode?.mode === "needs_update";
  const canonicalHubReadiness = input.hubReadiness ?? null;
  const canonicalReadinessStatus = canonicalHubReadiness?.status ?? null;
  const allowsCanonicalContinuation = canonicalHubReadiness?.allowsContinuation ?? false;
  const canonicalDrivers = canonicalHubReadiness?.drivers ?? [];

  let title = "Continuer depuis l'affaire";
  let summary =
    "Le cockpit doit vous mener a la prochaine action utile sans vous disperser.";
  let statusLabel = "Parcours affaire-first";
  let statusVariant: PanelModel["statusVariant"] = "info";
  let heroState: PanelModel["heroState"] = "ready_to_continue";
  let reviewImpact: PanelModel["reviewImpact"] = undefined;
  let readinessLevel: PanelModel["readinessLevel"] = "not_ready";
  let resultCard: PanelResultCard | null = null;
  let primaryAction: PanelAction | null = null;
  const hasDpgf = hasDetectedDocumentKind(input.intakeWorkspace, "dpgf");
  const hasPlans = hasDetectedDocumentKind(input.intakeWorkspace, "plans");
  const hasCctp = hasDetectedDocumentKind(input.intakeWorkspace, "cctp");
  const reviewDocument = sortReviewDocuments(documents, missingPieces)[0] ?? null;
  const briefDraft = input.intakeWorkspace?.briefDraft ?? null;
  const hasMissingPrimaryDpgf = hasExplicitMissingPrimary(documents, "dpgf");
  const hasMissingPrimaryCctp = hasExplicitMissingPrimary(documents, "cctp");
  const hasDocumentReservations =
    documentReadinessFlags.length > 0 ||
    hasOpenCriticalRegisterDocumentRisk(input.registerSummary);
  const hasCanonicalWorkReservations = canonicalReadinessStatus === "ready_with_reservations";
  const hasWorkReservations = hasDocumentReservations || hasCanonicalWorkReservations;
  const documentReservationFacts = dedupe(
    documentReadinessFlags.map((flag) => flag.label).slice(0, 2),
  );
  const clarificationCount =
    input.registerSummary?.clarifyWithClientCount ??
    canonicalHubReadiness?.register.clarifyWithClientCount ??
    0;
  const continuationHypothesisCount =
    input.registerSummary?.continuedWithHypothesisCount ??
    canonicalHubReadiness?.register.continuedWithHypothesisCount ??
    0;
  const revalidationCount =
    input.registerSummary?.revalidationRequiredCount ??
    canonicalHubReadiness?.register.revalidationRequiredCount ??
    0;
  const hasClarificationDriver = canonicalDrivers.some(
    (driver) => driver.code === "client_clarification",
  );
  const hasContinuationHypothesisDriver = canonicalDrivers.some(
    (driver) => driver.code === "continued_with_hypothesis",
  );
  const hasRevalidationDriver = canonicalDrivers.some(
    (driver) => driver.code === "revalidation_required",
  );
  const continuationHypothesisFact =
    continuationHypothesisCount > 0
      ? `${formatCountLabel(
          continuationHypothesisCount,
          "hypothese de continuation active",
          "hypotheses de continuation actives",
        )}`
      : "";
  const clarificationFact =
    clarificationCount > 0
      ? `${formatCountLabel(
          clarificationCount,
          "clarification client ouverte",
          "clarifications client ouvertes",
        )}`
      : "";
  const revalidationFacts = (input.registerSummary?.revalidationImpactedStages ?? [])
    .slice(0, 2)
    .map((stage) => AFFAIRE_REGISTER_REVALIDATION_IMPACTED_STAGE_LABELS[stage]);
  const manualEstimateHref = buildManualEstimateHref({
    projectId: input.projectId,
    currentVersion: input.currentVersion,
  });
  const reviewCouldResolveCriticalMissing =
    reviewDocument !== null &&
    getReviewProbableCategories(reviewDocument).some((category) =>
      hasCriticalMissingCategory(missingPieces, category),
    );
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
    summary =
      reviewIntakeSuggestion?.preview ??
      "Certains documents restent ambigus. Confirmez-les avant de poursuivre.";
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
      facts: [
        reviewIntakeSuggestion
          ? `${reviewIntakeSuggestion.label.replace("Confirmer ", "")}`
          : "1 document a confirmer",
      ],
      evidence: dedupe([
        reviewDocument?.fileName ?? "",
        reviewDocument
          ? `Classification a confirmer (${formatConfidenceLabel(reviewDocument.confidence)})`
          : "",
        reviewCouldResolveCriticalMissing ? "Peut lever un manque critique" : "",
        reviewDocument?.issues[0] ?? "",
      ]).filter(Boolean),
    };
  } else if (hasMissingPrimaryDpgf || hasMissingPrimaryCctp) {
    const categories = [
      ...(hasMissingPrimaryDpgf ? ["DPGF"] : []),
      ...(hasMissingPrimaryCctp ? ["CCTP"] : []),
    ];
    title =
      categories.length === 1
        ? `Choisir le ${categories[0]} principal`
        : "Choisir les documents principaux";
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
        hasMissingPrimaryDpgf
          ? `${documents.filter((document) => document.detectedCategory === "dpgf").length} DPGF detectes`
          : "",
        hasMissingPrimaryCctp
          ? `${documents.filter((document) => document.detectedCategory === "cctp").length} CCTP detectes`
          : "",
        "Analyse et comparaison disponibles tant que le principal n'est pas choisi.",
      ]).filter(Boolean),
    };
  } else if (criticalMissingPieces.length > 0 || missingPieces.length > 0) {
    const count = criticalMissingPieces.length > 0 ? criticalMissingPieces.length : missingPieces.length;
    const missingPiecesAllowContinuation =
      allowsCanonicalContinuation && canonicalReadinessStatus !== "not_ready";
    title = missingPiecesAllowContinuation ? "Consolider le dossier" : "Completer le dossier";
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
            label: "Completer le dossier",
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
        ? confirmBriefSuggestion?.preview ??
          "Valider le cadrage du dossier avant de debloquer la suite du chiffrage assiste."
        : confirmBriefSuggestion?.preview ??
          "Valider le cadrage du dossier pour debloquer la suite du chiffrage assiste.";
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
      title:
        canonicalReadinessStatus === "not_ready"
          ? "Base de travail insuffisante"
          : "Dossier exploitable",
      message:
        canonicalReadinessStatus === "not_ready"
          ? "Confirmez le cadrage metier avant de structurer le devis ou de lancer le metre."
          : "Les pieces critiques sont presentes. Confirmez le cadrage metier avant de chiffrer.",
      readinessStatus: readinessLevel,
      action: primaryAction,
      facts: dedupe([
        hasDpgf ? "DPGF detecte" : "",
        hasPlans ? "Plans detectes" : "",
        hasCctp ? "CCTP detecte" : "",
      ]).filter(Boolean),
      evidence: dedupe([
        briefDraft?.projectObject ?? "",
        briefDraft?.lots.length
          ? `Lots: ${briefDraft.lots.slice(0, 2).join(", ")}`
          : "",
        briefDraft?.vigilancePoints[0]
          ? `Point de vigilance: ${briefDraft.vigilancePoints[0]}`
          : "",
      ]).filter(Boolean),
    };
  } else if (canonicalReadinessStatus === "not_ready") {
    const reviewPending = canonicalHubReadiness?.drivers.some((driver) => driver.code === "review_pending") ?? false;
    const briefPending =
      canonicalHubReadiness?.drivers.some(
        (driver) => driver.code === "brief_missing" || driver.code === "brief_to_confirm",
      ) ?? false;
    const canonicalMissingCount =
      canonicalHubReadiness?.intake.confirmedCriticalMissingPiecesCount ||
      canonicalHubReadiness?.intake.confirmedMissingPiecesCount ||
      0;

    title = reviewPending
      ? "Vérifier les documents reçus"
      : briefPending
        ? "Confirmer le brief"
        : canonicalMissingCount > 0
          ? "Completer le dossier"
          : "Stabiliser le dossier";
    summary = reviewPending
      ? reviewIntakeSuggestion?.preview ??
        "Des documents doivent encore etre confirmes avant toute reprise du chiffrage."
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
                label: "Completer le dossier",
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
      title:
        revalidationCount > 1
          ? `${revalidationCount} revalidations a relancer`
          : "Revalidation a relancer",
      message:
        revalidationFacts.length > 0
          ? `Le dossier a change. Relancez d'abord ${revalidationFacts.join(" + ").toLowerCase()} avant de reprendre la remise.`
          : "Le dossier a change. Relancez la revalidation ciblee avant de poursuivre.",
      readinessStatus: readinessLevel,
      action: primaryAction,
      facts: dedupe([
        formatCountLabel(
          Math.max(revalidationCount, 1),
          "revalidation requise",
          "revalidations requises",
        ),
        ...revalidationFacts,
      ]).filter(Boolean),
      evidence: ["Tracee dans le registre affaire"],
    };
  } else if (
    hasClarificationDriver &&
    clarificationSuggestion
  ) {
    title = clarificationSuggestion.label;
    summary = clarificationSuggestion.preview;
    statusLabel = "Clarification client requise";
    statusVariant = "warning";
    heroState = "ready_to_continue";
    readinessLevel = canonicalReadinessStatus ?? "ready_with_reservations";
    primaryAction = toSuggestionAction(clarificationSuggestion);
    resultCard = {
      kind: "primary",
      title:
        clarificationCount > 1
          ? `${clarificationCount} clarifications client ouvertes`
          : "Clarification client ouverte",
      message:
        "Le dossier reste exploitable, mais un retour client est encore attendu avant la remise.",
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
      title: hasWorkReservations
        ? "Passage en hybride sous reserves"
        : "Passage en hybride recommande",
      message: hasWorkReservations
        ? "Le devis existe deja en mode manuel. Importez la DPGF dans cette meme structure pour converger vers un mode hybride, mais le dossier reste sous reserves."
        : "Le devis existe déjà en mode manuel. Importez la DPGF dans cette même structure pour converger vers un mode hybride sans repartir de zéro.",
      readinessStatus: readinessLevel,
      action: primaryAction,
      facts: dedupe([
        structureModeDescription?.badgeLabel ?? "",
        ...(structureModeDescription?.facts ?? []),
        input.structureMode?.linkedDpgfMappedRowCount
          ? `${formatCountLabel(
              input.structureMode.linkedDpgfMappedRowCount,
              "ligne DPGF importable",
              "lignes DPGF importables",
            )}`
          : "",
        clarificationFact,
        continuationHypothesisFact,
        ...(hasWorkReservations ? documentReservationFacts : []),
      ]).filter(Boolean),
      evidence: ["La structure actuelle sera enrichie sans perdre les lignes déjà saisies."],
    };
  } else if (shouldOpenLinkedDpgfAsBase && input.currentVersion && input.dpgfSource) {
    title = "Importer la DPGF";
    summary =
      "Le DPGF principal est pret. Utilisez-le comme base du devis avant d'ajouter vos completements manuels.";
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
      title: hasWorkReservations
        ? "Base DPGF importable sous reserves"
        : "Base DPGF prete a importer",
      message: hasWorkReservations
        ? "La DPGF principale est validee. Importez-la comme base du devis, mais gardez en tete que le dossier reste encore sous reserves."
        : "La DPGF principale est validee. Importez-la comme base du devis pour pre-remplir la structure avant les ajustements manuels.",
      readinessStatus: readinessLevel,
      action: primaryAction,
      facts: dedupe([
        "DPGF principal valide",
        input.dpgfSource.mappedRowCount > 0
          ? `${formatCountLabel(
              input.dpgfSource.mappedRowCount,
              "ligne importable",
              "lignes importables",
            )}`
          : "",
        ...(hasWorkReservations ? documentReservationFacts : []),
      ]).filter(Boolean),
      evidence: dedupe([
        input.dpgfSource.filename,
        input.dpgfSource.mappingStatus === "applied"
          ? "Mapping déjà appliqué"
          : "Mapping valide",
      ]).filter(Boolean),
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
    readinessLevel =
      input.hubReadiness?.status ??
      (hasDocumentReservations ? "ready_with_reservations" : "ready");
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
        hasDpgf
          ? hasWorkReservations
            ? "Base devis disponible sous reserves"
            : "Base devis prete"
          : "",
        ...documentReservationFacts,
      ]).filter(Boolean),
    };
  } else if (generateStructureSuggestion) {
    const hasStructureDraft = generateStructureSuggestion.label
      .toLowerCase()
      .includes("revoir");
    const isPreliminaryStructure = isPreliminaryStructureSuggestion(
      generateStructureSuggestion,
    );
    const preliminaryContext = isPreliminaryStructure
      ? describePreliminaryStructureContext(input.intakeWorkspace)
      : null;
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
          : preliminaryContext?.title ?? "Structure preliminaire editable"
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
            : preliminaryContext?.message ??
              "Le brief confirme suffit pour ouvrir une structure preliminaire editable."
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
            hasDpgf
              ? hasWorkReservations
                ? "Base devis disponible sous reserves"
                : "Base devis prete"
              : "",
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
  } else if (
    submissionReadiness &&
    (submissionReadiness.status === "ready" || submissionReadiness.status === "warning")
  ) {
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
          ? [
              `${planExceptionCount} ecart${planExceptionCount > 1 ? "s" : ""} majeur${planExceptionCount > 1 ? "s" : ""} sur les metres`,
            ]
          : []),
        ...finishLineBlockers,
      ]).slice(0, 3);

  const hasDominantRegisterAction =
    primaryAction?.kind === "suggestion" &&
    (primaryAction.key === "review-revalidation" ||
      primaryAction.key === "list-clarifications");
  const hasHybridPrimaryAction = primaryAction ? isHybridStructureAction(primaryAction) : false;
  const allowSecondaryAides =
    heroState === "ready_to_continue" && !hasDominantRegisterAction;
  const aides: PanelAction[] = [];
  if (
    (allowSecondaryAides || heroState === "structure") &&
    manualEstimateHref &&
    primaryAction?.key !== "manual-estimate" &&
    !hasHybridPrimaryAction
  ) {
    aides.push(
      toHrefAction({
        key: "manual-estimate",
        label: "Continuer en manuel",
        description:
          "Ouvrir le devis sans attendre un import DPGF. Vous pourrez completer ou hybrider plus tard.",
        href: manualEstimateHref,
        variant: "ghost",
      }),
    );
  }
  if (
    allowSecondaryAides &&
    clarificationSuggestion &&
    primaryAction?.key !== clarificationSuggestion.actionId
  ) {
    aides.push(toSuggestionAction(clarificationSuggestion, "ghost"));
  }
  if (
    allowSecondaryAides &&
    generateStructureSuggestion &&
    primaryAction?.key !== generateStructureSuggestion.actionId
  ) {
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

  if (
    allowSecondaryAides &&
    analyzePlansSuggestion &&
    primaryAction?.key !== analyzePlansSuggestion.actionId
  ) {
    aides.push(toSuggestionAction(analyzePlansSuggestion, "ghost"));
  } else if (
    allowSecondaryAides &&
    input.takeoffEnabled &&
    primaryAction?.key !== "plans" &&
    (input.plansSummary?.planSetCount ?? 0) > 0
  ) {
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

function ActionButton({
  action,
  onExecuteSuggestion,
}: {
  action: PanelAction;
  onExecuteSuggestion?: (suggestion: CockpitSuggestion) => void;
}) {
  if (action.kind === "href") {
    return (
      <Link href={action.href} className={getActionClassName(action.variant)}>
        {action.label}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={getActionClassName(action.variant)}
      onClick={() => onExecuteSuggestion?.(action.suggestion)}
    >
      {action.label}
    </button>
  );
}

function ResultFactPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-white/70 bg-white/88 px-3 py-1 text-xs font-medium text-[var(--slate-700)]">
      {label}
    </span>
  );
}

function getCategoryStoryIcon(category: string) {
  if (category === "plans") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
        <line x1="3" x2="21" y1="9" y2="9" />
        <line x1="9" x2="9" y1="21" y2="9" />
      </svg>
    );
  }
  if (category === "cctp") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  }
  if (category === "dpgf" || category === "bpu_dqe") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" x2="8" y1="13" y2="13" />
        <line x1="16" x2="8" y1="17" y2="17" />
      </svg>
    );
  }
  if (category === "emails") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="20" height="16" x="2" y="4" rx="2" />
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function getStateWhyContent(card: PanelResultCard) {
  const isStructureResumeCard =
    card.kind === "structure" && isStructureResumeAction(card.action);
  const isPreliminaryStructureCard =
    card.kind === "structure" &&
    card.action.label.toLowerCase().includes("structure preliminaire");
  const isHybridStructureCard =
    card.kind === "structure" && isHybridStructureAction(card.action);
  const isDpgfImportStructureCard =
    card.kind === "structure" && isDpgfImportStructureAction(card.action);
  const isNeedsUpdateStructureCard =
    card.kind === "structure" &&
    (card.title.toLowerCase().includes("remettre a jour") ||
      card.facts.some((fact) => fact.toLowerCase().includes("a revoir")));

  if (card.kind === "primary") {
    return {
      title: "TIMAX peut analyser plusieurs DPGF / CCTP, mais un seul document principal doit etre choisi par categorie pour lancer les automatismes engageants.",
      hints: (card.evidence ?? []).slice(0, 2),
    };
  }
  if (card.kind === "missing") {
    return {
      title: "Le dossier reste incomplet tant que les pieces critiques ne sont pas presentes.",
      hints: card.facts.slice(0, 3),
    };
  }
  if (card.kind === "brief") {
    if (card.readinessStatus === "not_ready") {
      return {
        title:
          "Le cadrage metier n'est pas encore stabilise. Confirmez le brief avant de lancer la structure ou le metre.",
        hints: [...card.facts.slice(0, 2), ...(card.evidence ?? []).slice(0, 1)],
      };
    }

    return {
      title: "Le dossier est exploitable, mais le cadrage metier doit etre valide avant de structurer le devis.",
      hints: [...card.facts.slice(0, 2), ...(card.evidence ?? []).slice(0, 1)],
    };
  }
  if (card.kind === "structure") {
    return {
      title: isDpgfImportStructureCard
        ? "La DPGF principale est déjà validée. La prochaine action est de l'utiliser comme base du devis."
        : isHybridStructureCard
          ? "Le devis existe déjà. La prochaine action est d'enrichir cette même structure en mode hybride."
        : isNeedsUpdateStructureCard
          ? "Une partie de la structure existe déjà, mais certaines lignes doivent encore être revues avant de reprendre le chiffrage."
        : isPreliminaryStructureCard
          ? "Le brief ou le CCTP permettent d'ouvrir une trame editable de structure provisoire, sans imposer un import DPGF."
        : isStructureResumeCard
          ? "Le brief est confirme. La prochaine action est de reprendre la structure du devis."
          : "Le brief est confirmé. La prochaine action est de générer la structure du devis.",
      hints: card.facts.slice(0, 3),
    };
  }
  return {
    title: "La base devis et les plans sont prets. Le metre peut demarrer depuis cette etape.",
    hints: card.facts.slice(0, 3),
  };
}

function getStateHeroBadgeLabel(card: PanelResultCard) {
  if (card.kind === "primary") return "Référence principale à définir";
  if (card.kind === "missing") return "Pieces critiques manquantes";
  if (card.kind === "brief") {
    return card.readinessStatus === "not_ready" ? "Brief a confirmer" : "Dossier exploitable";
  }
  if (card.kind === "structure") {
    if (isDpgfImportStructureAction(card.action)) {
      return "Base DPGF";
    }
    if (isHybridStructureAction(card.action)) {
      return "Mode hybride";
    }
    if (
      card.title.toLowerCase().includes("remettre a jour") ||
      card.facts.some((fact) => fact.toLowerCase().includes("a revoir"))
    ) {
      return "Structure a remettre a jour";
    }
    if (card.action.label.toLowerCase().includes("structure preliminaire")) {
      return "Structure preliminaire";
    }
    return isStructureResumeAction(card.action)
      ? "Structure a reprendre"
      : "Structure à générer";
  }
  return "Analyse des plans";
}

function ResultCard({
  projectId,
  card,
  intakeWorkspace,
  onOpenIntakeUpload,
  onExecuteSuggestion,
}: {
  projectId: string;
  card: PanelResultCard;
  intakeWorkspace: AffaireFlowHierarchyPanelProps["intakeWorkspace"];
  onOpenIntakeUpload: () => void;
  onExecuteSuggestion?: (suggestion: CockpitSuggestion) => void;
}) {
  const router = useRouter();
  const [selectedReviewCategory, setSelectedReviewCategory] = useState<string | null>(null);
  const [reviewPreviewCategory, setReviewPreviewCategory] = useState<string | null>(null);
  const [reviewActionError, setReviewActionError] = useState<string | null>(null);
  const [isReviewActionPending, startReviewActionTransition] = useTransition();
  const evidence = "evidence" in card ? (card.evidence ?? []) : [];
  const documents = ensureDocumentPriorities(intakeWorkspace?.documents ?? []);
  const reviewDocs = sortReviewDocuments(documents, intakeWorkspace?.missingPieces ?? []);
  const processingDocs = documents.filter((document) => isDocumentProcessing(document));
  const classifiedDocs = documents.filter(
    (document) => !isDocumentNeedingReview(document) && !isDocumentProcessing(document),
  );
  const primaryEligibleClassifiedDocs = classifiedDocs.filter((document) =>
    isAffaireIntakePrimaryEligibleKind(document.detectedCategory),
  );
  const primaryDocs = primaryEligibleClassifiedDocs.filter(
    (document) => (document.documentPriority ?? "secondary") === "primary",
  );
  const secondaryDocs = primaryEligibleClassifiedDocs.filter(
    (document) => (document.documentPriority ?? "secondary") !== "primary",
  );
  const hasPrimaryDpgf = primaryDocs.some((document) => document.detectedCategory === "dpgf");
  const hasPrimaryCctp = primaryDocs.some((document) => document.detectedCategory === "cctp");
  const classifiedDpgfCount = primaryEligibleClassifiedDocs.filter(
    (document) => document.detectedCategory === "dpgf",
  ).length;
  const classifiedCctpCount = primaryEligibleClassifiedDocs.filter(
    (document) => document.detectedCategory === "cctp",
  ).length;
  const secondaryDpgfCount = secondaryDocs.filter(
    (document) => document.detectedCategory === "dpgf",
  ).length;
  const secondaryCctpCount = secondaryDocs.filter(
    (document) => document.detectedCategory === "cctp",
  ).length;
  const docsByCategory = new Map<typeof classifiedDocs[number]["detectedCategory"], typeof classifiedDocs>();
  for (const document of classifiedDocs) {
    const list = docsByCategory.get(document.detectedCategory) ?? [];
    docsByCategory.set(document.detectedCategory, [...list, document]);
  }
  const sortedCategories = [...docsByCategory.keys()].sort(categorySort);
  const classifiedCount = classifiedDocs.length;
  const reviewCount = reviewDocs.length;
  const processingCount = processingDocs.length;
  const totalCount = documents.length;
  const classifiedPct = totalCount > 0 ? (classifiedCount / totalCount) * 100 : 0;
  const reviewPct = totalCount > 0 ? (reviewCount / totalCount) * 100 : 0;
  const processingPct = totalCount > 0 ? (processingCount / totalCount) * 100 : 0;
  const progressLegend = [
    classifiedCount > 0 ? `${classifiedCount} valide${classifiedCount > 1 ? "s" : ""}` : null,
    reviewCount > 0 ? `${reviewCount} a confirmer` : null,
    processingCount > 0 ? `${processingCount} en cours` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const lowerPanelSummary =
    card.kind === "review"
      ? reviewCount > 1
        ? `${reviewCount - 1} autre${reviewCount - 1 > 1 ? "s" : ""} piece${reviewCount - 1 > 1 ? "s" : ""} a confirmer apres la piece active`
        : "Détail de la pièce active à confirmer"
      : card.kind === "primary"
        ? `${classifiedDpgfCount > 0 ? `${classifiedDpgfCount} DPGF` : ""}${classifiedDpgfCount > 0 && classifiedCctpCount > 0 ? " / " : ""}${classifiedCctpCount > 0 ? `${classifiedCctpCount} CCTP` : ""} à arbitrer`
      : card.kind === "missing"
        ? `${classifiedCount} pièce${classifiedCount > 1 ? "s" : ""} déjà reçue${classifiedCount > 1 ? "s" : ""}`
      : `${classifiedCount} document${classifiedCount > 1 ? "s" : ""} valide${classifiedCount > 1 ? "s" : ""}`;
  const showMissingLowerPanel = card.kind === "missing" && sortedCategories.length > 0;
  const showPrimaryLowerPanel =
    card.kind === "primary" &&
    sortedCategories.some((category) => category === "dpgf" || category === "cctp");
  const priorityAlerts = [
    ...(classifiedDpgfCount > 0 && !hasPrimaryDpgf
      ? [buildMissingPrimaryIllustrationItem({ category: "dpgf", count: classifiedDpgfCount })]
      : []),
    ...(classifiedCctpCount > 0 && !hasPrimaryCctp
      ? [buildMissingPrimaryIllustrationItem({ category: "cctp", count: classifiedCctpCount })]
      : []),
  ];
  const nonPriorityEligibleClassifiedDocs = classifiedDocs.filter(
    (document) => !isAffaireIntakePrimaryEligibleKind(document.detectedCategory),
  );
  const validatedContextItems = [
    ...primaryDocs.map((document) => buildValidatedIllustrationItem(document)),
    ...priorityAlerts,
    ...nonPriorityEligibleClassifiedDocs.map((document) => buildValidatedIllustrationItem(document)),
    ...(hasPrimaryDpgf && secondaryDpgfCount > 0
      ? [buildComplementarySummaryIllustrationItem({ category: "dpgf", count: secondaryDpgfCount })]
      : []),
    ...(hasPrimaryCctp && secondaryCctpCount > 0
      ? [buildComplementarySummaryIllustrationItem({ category: "cctp", count: secondaryCctpCount })]
      : []),
  ];
  const visibleValidatedContextItems = validatedContextItems.slice(0, MAX_HERO_VALIDATED_ITEMS);
  const hiddenValidatedCount = validatedContextItems
    .slice(MAX_HERO_VALIDATED_ITEMS)
    .reduce((total, item) => total + (item.representedCount ?? 0), 0);
  const validatedOverflowItem =
    hiddenValidatedCount > 0 ? buildValidatedOverflowIllustrationItem(hiddenValidatedCount) : null;
  const visibleMissingItems = (intakeWorkspace?.missingPieces ?? [])
    .slice(0, MAX_HERO_MISSING_ITEMS)
    .map((piece) => buildMissingIllustrationItem(piece));
  const hiddenMissingCount = Math.max(
    0,
    (intakeWorkspace?.missingPieces?.length ?? 0) - visibleMissingItems.length,
  );
  const missingOverflowItem =
    hiddenMissingCount > 0 ? buildMissingOverflowIllustrationItem(hiddenMissingCount) : null;
  const visibleValidatedCount = visibleValidatedContextItems.reduce(
    (total, item) => total + (item.representedCount ?? 0),
    0,
  );
  const reviewAdditionalCount = Math.max(0, reviewCount - 1);
  const showReviewContextSection =
    card.kind === "review" &&
    reviewAdditionalCount === 0 &&
    classifiedCount > visibleValidatedCount;
  const showReviewLowerPanel =
    card.kind === "review" && (reviewAdditionalCount > 0 || showReviewContextSection);
  const showContextLowerPanel =
    card.kind !== "review" &&
    card.kind !== "missing" &&
    card.kind !== "primary" &&
    (evidence.length > 0 ||
      classifiedCount > visibleValidatedCount ||
      reviewCount > 0 ||
      processingCount > 0);
  const showLowerPanel =
    card.kind === "missing"
      ? showMissingLowerPanel
      : card.kind === "primary"
        ? showPrimaryLowerPanel
        : card.kind === "review"
          ? showReviewLowerPanel
          : showContextLowerPanel;

  const stateToneClassName =
    card.kind === "review"
      ? "border-amber-400 bg-amber-100"
      : card.kind === "primary"
        ? "border-amber-300 bg-amber-50"
      : card.kind === "missing"
        ? "border-danger/20 bg-error-light"
        : card.kind === "brief"
          ? card.readinessStatus === "not_ready"
            ? "border-amber-300 bg-amber-50"
            : "border-sky-200 bg-sky-50"
          : card.kind === "structure"
            ? "border-indigo-200 bg-indigo-50"
            : "border-emerald-200 bg-emerald-50";
  const illustrationItems: IllustrationItem[] = [
    ...visibleValidatedContextItems,
    ...(validatedOverflowItem ? [validatedOverflowItem] : []),
    ...(card.kind === "missing" ? visibleMissingItems : []),
    ...(card.kind === "missing" && missingOverflowItem ? [missingOverflowItem] : []),
  ];
  const reviewStoryCategories =
    card.kind === "review"
      ? getReviewProbableCategories(reviewDocs[0] ?? null)
      : [];
  const reviewEvidenceHints =
    card.kind === "review"
      ? getReviewEvidenceHints(reviewDocs[0] ?? null, intakeWorkspace?.missingPieces ?? [])
      : [];
  const reviewPrimaryIllustrationItem =
    card.kind === "review" && reviewDocs[0]
      ? ({
          key: reviewDocs[0].documentId,
          title: reviewDocs[0].fileName,
          subtitle: getCategoryIllustrationLabel(reviewDocs[0].detectedCategory),
          isMissing: false,
          ...getFileIllustrationTone(reviewDocs[0].fileName),
        } satisfies IllustrationItem)
      : null;
  const activeReviewCategory = reviewPreviewCategory ?? selectedReviewCategory;
  const stateWhyContent = card.kind === "review" ? null : getStateWhyContent(card);
  const reviewMissingIllustrationItems =
    card.kind === "review"
      ? (intakeWorkspace?.missingPieces ?? [])
          .slice(0, MAX_HERO_MISSING_ITEMS)
          .map((piece) => buildMissingIllustrationItem(piece, "review_context"))
      : [];
  const reviewHiddenMissingCount =
    card.kind === "review"
      ? Math.max(0, (intakeWorkspace?.missingPieces?.length ?? 0) - reviewMissingIllustrationItems.length)
      : 0;
  const reviewMissingOverflowItem =
    card.kind === "review" && reviewHiddenMissingCount > 0
      ? buildMissingOverflowIllustrationItem(reviewHiddenMissingCount)
      : null;
  const reviewOverflowItem =
    card.kind === "review" && reviewDocs.length > 1
      ? buildReviewOverflowIllustrationItem(reviewDocs.length - 1)
      : null;
  const reviewValidatedIllustrationItems = [
    ...visibleValidatedContextItems,
    ...(validatedOverflowItem ? [validatedOverflowItem] : []),
  ];
  const handleSelectReviewCategory = (category: string) => {
    setSelectedReviewCategory(category);
    setReviewActionError(null);
  };
  const handleConfirmReviewCategory = () => {
    const reviewDocument = reviewDocs[0];
    if (!reviewDocument || !selectedReviewCategory) {
      return;
    }

    setReviewActionError(null);
    startReviewActionTransition(async () => {
      try {
        await reclassifyAffaireDocument({
          projectId,
          documentId: reviewDocument.documentId,
          category: selectedReviewCategory as "dpgf" | "plans" | "cctp" | "bpu_dqe" | "annexes" | "emails" | "a_classer",
        });
        router.refresh();
      } catch {
        setReviewActionError("Impossible de reclasser ici. Utilisez Reclasser dans le dossier.");
      } finally {
        setSelectedReviewCategory(null);
      }
    });
  };

  return (
    <div className="mt-4">
      <div className="relative overflow-hidden rounded-[1.5rem] border border-[#d5c6af] bg-[#e8dcc9] p-4 sm:p-6">
        <div className="relative overflow-hidden rounded-[1rem] border-2 border-dashed border-white/45 bg-[var(--foreground)] shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
          <div
            className="absolute inset-0 opacity-45"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.24) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.24) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />
          <svg
            viewBox="0 0 800 600"
            className={`absolute inset-0 h-full w-full ${card.kind === "review" ? "text-white/7" : "text-white/12"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M140 90h480v330H140z" />
            <path d="M230 150h160v140H230z" />
            <path d="M420 150h170" />
            <path d="M420 220h170" />
            <path d="M420 290c38 0 66 10 84 30" />
            <path d="M230 390h360" />
            <path d="M230 460h240" />
            <path d="M200 140v320" />
            <path d="M640 120v290" />
            <path d="M280 120v-28" />
            <path d="M560 120v-28" />
          </svg>

          <div className="relative z-10 p-4 sm:p-6">
            {card.kind === "review" ? (
              <div className="mb-5 flex flex-col items-center">
                <div className="flex flex-wrap items-start justify-center gap-3 sm:gap-4">
                  {reviewValidatedIllustrationItems.map((item) => (
                    <div
                      key={item.key}
                      className={`relative mt-1 w-[9rem] rounded-2xl border px-3 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.14)] backdrop-blur-sm transition-transform ${item.frame}`}
                      style={{ transform: "rotate(-2deg)" }}
                    >
                      <div className={`text-[11px] font-bold uppercase tracking-[0.12em] ${item.accent}`}>
                        {item.label}
                      </div>
                      <p className="mt-2 truncate text-sm font-semibold text-[var(--slate-800)]" title={item.title}>
                        {item.title}
                      </p>
                      {item.subtitle ? (
                        <p className="mt-1 text-xs text-[var(--slate-500)]">{item.subtitle}</p>
                      ) : null}
                    </div>
                  ))}
                  <div className="flex flex-col items-center">
                    {(reviewPrimaryIllustrationItem ? [reviewPrimaryIllustrationItem] : []).map((item) => (
                      <div
                        key={item.key}
                        className={`relative w-[9rem] rounded-2xl border px-3 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.14)] backdrop-blur-sm transition-transform ${item.frame}`}
                        style={{ transform: "rotate(-2deg)" }}
                      >
                        <div className={`text-[11px] font-bold uppercase tracking-[0.12em] ${item.accent}`}>
                          {item.label}
                        </div>
                        <p className="mt-2 truncate text-sm font-semibold text-[var(--slate-800)]" title={item.title}>
                          {item.title}
                        </p>
                        <p className="mt-1 text-xs text-[var(--slate-500)]">{item.subtitle}</p>
                      </div>
                    ))}
                    <div className="mt-3 flex h-8 w-px flex-col items-center justify-center bg-white/30">
                      <span className="inline-flex h-2 w-2 rounded-full bg-white/60" />
                    </div>
                    <div className="mt-1 flex w-full justify-center">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/35 bg-white/12 px-4 py-2 text-center text-sm font-medium text-white/92 backdrop-blur-sm">
                        <span>TIMAX hesite entre</span>
                        <Popover
                          hover
                          className="z-20"
                          placement="right"
                          contentClassName="border-[var(--slate-200)] bg-white text-[var(--slate-700)] shadow-[0_18px_40px_rgba(15,23,42,0.22)]"
                          arrowClassName="border-[var(--slate-200)] bg-white"
                          trigger={(
                            <button
                              type="button"
                              aria-label="Pourquoi TIMAX hesite"
                              className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-white/10 text-sky-50/80 transition-colors hover:bg-white/18 hover:text-white"
                            >
                              <svg
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <circle cx="12" cy="12" r="10" />
                                <path d="M9.09 9a3 3 0 1 1 5.82 1c0 2-3 2-3 4" />
                                <line x1="12" x2="12.01" y1="17" y2="17" />
                              </svg>
                            </button>
                          )}
                        >
                          <div className="space-y-2">
                            <p className="text-xs leading-5 text-[var(--slate-700)]">
                              TIMAX hesite car le document ne contient pas assez d&apos;indices pour trancher automatiquement.
                            </p>
                            {reviewEvidenceHints.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {reviewEvidenceHints.map((hint) => (
                                  <span
                                    key={hint}
                                    className="rounded-full border border-[var(--slate-200)] bg-[var(--slate-50)] px-2.5 py-1 text-[11px] font-medium text-[var(--slate-600)]"
                                  >
                                    {hint}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </Popover>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2.5">
                      {reviewStoryCategories.map((category, index) => {
                        const secondaryBadge = getReviewChoiceSecondaryBadge({
                          category,
                          hasPrimaryDpgf,
                          hasPrimaryCctp,
                        });

                        return (
                          <button
                            key={category}
                            type="button"
                            onClick={() => handleSelectReviewCategory(category)}
                            onMouseEnter={() => setReviewPreviewCategory(category)}
                            onFocus={() => setReviewPreviewCategory(category)}
                            onMouseLeave={() => setReviewPreviewCategory(null)}
                            onBlur={() => setReviewPreviewCategory(null)}
                            disabled={isReviewActionPending}
                            className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium shadow-sm transition-all ${
                              selectedReviewCategory === category
                                ? "border-[var(--brand-blue)] bg-[var(--brand-blue)] text-white"
                                : "border-white/35 bg-white/92 text-[var(--slate-700)] hover:-translate-y-0.5 hover:bg-white"
                            } ${isReviewActionPending ? "cursor-progress opacity-80" : ""}`}
                          >
                            <span className={selectedReviewCategory === category ? "text-white" : "text-[var(--brand-blue)]"}>
                              {getCategoryStoryIcon(category)}
                            </span>
                            <span>{getReviewChoiceLabel(category)}</span>
                            {index === 0 ? (
                              <span className="rounded-full bg-[var(--warning)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--warning-dark)]">
                                Probable
                              </span>
                            ) : null}
                            {secondaryBadge ? (
                              <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  selectedReviewCategory === category
                                    ? "bg-white/18 text-white"
                                    : "bg-[var(--slate-100)] text-[var(--slate-600)]"
                                }`}
                              >
                                {secondaryBadge}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                    <div
                      className={`relative mt-3 flex w-full justify-center ${
                        activeReviewCategory ? "mb-5 min-h-[3.5rem]" : ""
                      }`}
                    >
                      {activeReviewCategory ? (
                        <div className="pointer-events-none absolute left-1/2 top-0 z-10 w-max max-w-[min(90vw,42rem)] -translate-x-1/2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-center text-sm font-medium text-sky-50/96 backdrop-blur-sm">
                          {getReviewChoiceConsequence({
                            category: activeReviewCategory,
                            hasPrimaryDpgf,
                            hasPrimaryCctp,
                          })}
                        </div>
                      ) : null}
                    </div>
                    {selectedReviewCategory ? (
                      <div className={`flex justify-center ${activeReviewCategory ? "mt-16" : "mt-3"}`}>
                        <button
                          type="button"
                          onClick={handleConfirmReviewCategory}
                          disabled={isReviewActionPending}
                          className="btn btn-primary btn-sm"
                        >
                          {isReviewActionPending ? "Confirmation..." : "Confirmer la catégorie"}
                        </button>
                      </div>
                    ) : null}
                    {reviewActionError ? (
                      <p className="mt-3 text-sm font-medium text-amber-100">{reviewActionError}</p>
                    ) : null}
                  </div>
                  {reviewOverflowItem ? (
                    <div
                      key={reviewOverflowItem.key}
                      className={`relative mt-1 w-[9rem] rounded-2xl border px-3 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.14)] backdrop-blur-sm transition-transform ${reviewOverflowItem.frame}`}
                      style={{ transform: "rotate(2deg)" }}
                    >
                      <div className={`text-[11px] font-bold uppercase tracking-[0.12em] ${reviewOverflowItem.accent}`}>
                        {reviewOverflowItem.label}
                      </div>
                      <p className="mt-2 text-sm font-semibold text-[var(--slate-800)]">
                        {reviewOverflowItem.title}
                      </p>
                      <p className="mt-1 text-xs text-[var(--slate-500)]">{reviewOverflowItem.subtitle}</p>
                    </div>
                  ) : null}
                  {reviewMissingIllustrationItems.map((item) => (
                    <div
                      key={item.key}
                      className={`relative mt-2 w-[8rem] rounded-2xl border px-3 py-2.5 opacity-90 shadow-[0_12px_28px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-transform ${item.frame}`}
                      style={{ transform: "rotate(2deg)" }}
                    >
                      <div className={`text-[11px] font-bold uppercase tracking-[0.12em] ${item.accent}`}>
                        {item.label}
                      </div>
                      {item.severityLabel ? (
                        <div
                          className={`mt-3 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${item.severityToneClassName}`}
                        >
                          {item.severityLabel}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {reviewMissingOverflowItem ? (
                    <div
                      key={reviewMissingOverflowItem.key}
                      className={`relative mt-2 w-[8rem] rounded-2xl border px-3 py-2.5 opacity-90 shadow-[0_12px_28px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-transform ${reviewMissingOverflowItem.frame}`}
                      style={{ transform: "rotate(2deg)" }}
                    >
                      <div className={`text-[11px] font-bold uppercase tracking-[0.12em] ${reviewMissingOverflowItem.accent}`}>
                        {reviewMissingOverflowItem.label}
                      </div>
                      <p className="mt-2 text-sm font-semibold text-[var(--slate-800)]">
                        {reviewMissingOverflowItem.title}
                      </p>
                      <p className="mt-1 text-xs text-[var(--slate-500)]">{reviewMissingOverflowItem.subtitle}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : illustrationItems.length > 0 ? (
              <div className="mb-5 flex flex-col items-center">
                <div className="mb-4 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
                  {illustrationItems.map((item, index) => (
                    <div
                      key={item.key}
                      className={`relative w-[8.5rem] rounded-2xl border px-3 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.14)] backdrop-blur-sm transition-transform ${item.frame}`}
                      style={{ transform: `rotate(${index % 2 === 0 ? "-2deg" : "2deg"})` }}
                    >
                      <div className={`text-[11px] font-bold uppercase tracking-[0.12em] ${item.accent}`}>
                        {item.label}
                      </div>
                      {!(card.kind === "missing" && item.isMissing) ? (
                        <>
                          <p className="mt-2 truncate text-sm font-semibold text-[var(--slate-800)]" title={item.title}>
                            {item.title}
                          </p>
                          {item.subtitle ? (
                            <p className="mt-1 text-xs text-[var(--slate-500)]">{item.subtitle}</p>
                          ) : null}
                        </>
                      ) : null}
                      {card.kind === "missing" && item.isMissing && item.severityLabel ? (
                        <div
                          className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${item.severityToneClassName}`}
                        >
                          {item.severityLabel}
                        </div>
                      ) : null}
                      {card.kind === "missing" && item.isMissing ? (
                        <button
                          type="button"
                          onClick={onOpenIntakeUpload}
                          className="mt-3 inline-flex cursor-pointer items-center rounded-md border border-[var(--brand-blue)]/18 bg-[var(--brand-blue)]/8 px-2.5 py-1 text-xs font-semibold text-[var(--brand-blue)] transition-colors hover:bg-[var(--brand-blue)]/14"
                          aria-label={`Ajouter ${item.title}`}
                        >
                          Ajouter
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>

                {card.kind === "missing" ? (
                  null
                ) : (
                  <>
                    <div className="mt-1 flex w-full justify-center">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/35 bg-white/12 px-4 py-2 text-center text-sm font-medium text-white/92 backdrop-blur-sm">
                        <span>{getStateHeroBadgeLabel(card)}</span>
                        {stateWhyContent ? (
                          <Popover
                            hover
                            className="z-20"
                            placement="right"
                            contentClassName="border-[var(--slate-200)] bg-white text-[var(--slate-700)] shadow-[0_18px_40px_rgba(15,23,42,0.22)]"
                            arrowClassName="border-[var(--slate-200)] bg-white"
                            trigger={(
                              <button
                                type="button"
                                aria-label={`Pourquoi ${getStateHeroBadgeLabel(card)}`}
                                className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-white/10 text-sky-50/80 transition-colors hover:bg-white/18 hover:text-white"
                              >
                                <svg
                                  width="11"
                                  height="11"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <circle cx="12" cy="12" r="10" />
                                  <path d="M9.09 9a3 3 0 1 1 5.82 1c0 2-3 2-3 4" />
                                  <line x1="12" x2="12.01" y1="17" y2="17" />
                                </svg>
                              </button>
                            )}
                          >
                            <div className="space-y-2">
                              <p className="text-xs leading-5 text-[var(--slate-700)]">
                                {stateWhyContent.title}
                              </p>
                              {stateWhyContent.hints.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {stateWhyContent.hints.map((hint) => (
                                    <span
                                      key={hint}
                                      className="rounded-full border border-[var(--slate-200)] bg-[var(--slate-50)] px-2.5 py-1 text-[11px] font-medium text-[var(--slate-600)]"
                                    >
                                      {hint}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </Popover>
                        ) : null}
                      </div>
                    </div>
                    {card.facts.length > 0 ? (
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-2.5">
                        {card.facts.map((fact) => (
                          <ResultFactPill key={fact} label={fact} />
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-3 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-center text-sm font-medium text-sky-50/96 backdrop-blur-sm">
                      {card.message}
                    </div>
                    {card.action ? (
                      <div className="mt-3 flex justify-center">
                        <ActionButton action={card.action} onExecuteSuggestion={onExecuteSuggestion} />
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            {showLowerPanel ? (
            <div className="rounded-[1.25rem] border border-white/55 bg-white/96 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.14)] backdrop-blur-md">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--slate-800)]">
                    {card.kind === "missing"
                      ? "Pièces déjà reçues"
                      : card.kind === "primary"
                        ? "Choix principal"
                      : card.kind === "review"
                        ? reviewAdditionalCount > 0
                          ? "Autres pieces a confirmer"
                          : "Piece a confirmer"
                        : "Dossier de consultation"}
                  </h3>
                  <p className="mt-0.5 text-xs text-[var(--slate-500)]">
                    {totalCount > 0 ? lowerPanelSummary : card.message}
                  </p>
                </div>
                {reviewCount > 0 ? (
                  <div className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--slate-600)]">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                    </svg>
                    A revoir ({reviewCount})
                  </div>
                ) : null}
              </div>

              {totalCount > 0 && card.kind !== "review" && card.kind !== "missing" && card.kind !== "primary" ? (
                <div className="mb-4">
                  <div
                    className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--slate-100)]"
                    role="progressbar"
                    aria-valuenow={classifiedCount}
                    aria-valuemin={0}
                    aria-valuemax={totalCount}
                    aria-label={`Triage : ${progressLegend}`}
                  >
                    {classifiedPct > 0 ? (
                      <div className="h-full bg-[var(--success)] transition-all duration-500" style={{ width: `${classifiedPct}%` }} />
                    ) : null}
                    {reviewPct > 0 ? (
                      <div className="h-full bg-[var(--warning)] transition-all duration-500" style={{ width: `${reviewPct}%` }} />
                    ) : null}
                    {processingPct > 0 ? (
                      <div className="h-full bg-[var(--brand-blue)] transition-all duration-500" style={{ width: `${processingPct}%` }} />
                    ) : null}
                  </div>
                  <p className="mt-1.5 text-xs text-[var(--slate-500)]">{progressLegend}</p>
                </div>
              ) : null}

              {card.kind === "review" ? (
                <div className="space-y-4">
                  <section aria-label={reviewAdditionalCount > 0 ? "Autres pieces a confirmer" : "Piece active a confirmer"}>
                    <div className="space-y-2">
                      {(reviewAdditionalCount > 0 ? reviewDocs.slice(1, 3) : reviewDocs.slice(0, 1)).map((document) => (
                        <IntakeDocumentCard
                          key={document.documentId}
                          document={document}
                          projectId={projectId}
                          onReclassified={() => undefined}
                        />
                      ))}
                      {reviewAdditionalCount > 2 ? (
                        <div className="rounded-lg border border-[var(--warning)]/20 bg-amber-50 px-3 py-2 text-sm text-[var(--slate-600)]">
                          {reviewAdditionalCount - 2} autre{reviewAdditionalCount - 2 > 1 ? "s" : ""} piece{reviewAdditionalCount - 2 > 1 ? "s" : ""} a confirmer dans le dossier.
                        </div>
                      ) : null}
                    </div>
                  </section>

                  {showReviewContextSection ? (
                    <section aria-label="Contexte déjà classé">
                      <div className="mb-2 flex items-center gap-2">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-emerald-700" aria-hidden="true">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                          <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                        <h4 className="text-xs font-semibold text-emerald-900">Contexte déjà classé</h4>
                        <Badge variant="success" size="sm">{classifiedCount}</Badge>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {sortedCategories.map((category) => (
                          <IntakeCategoryCard
                            key={category}
                            category={category}
                            documents={docsByCategory.get(category) ?? []}
                            projectId={projectId}
                            onReclassified={() => undefined}
                            dpgfAlreadyImported={category === "dpgf" ? true : undefined}
                            plansSynced={category === "plans" ? true : undefined}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              ) : null}

              {card.kind === "missing" ? (
                <div className="space-y-4">
                  {sortedCategories.length > 0 ? (
                    <section aria-label="Pièces déjà reçues">
                      <div className="mb-2 flex items-center gap-2">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-emerald-700" aria-hidden="true">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                          <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                        <h4 className="text-xs font-semibold text-emerald-900">Deja dans le dossier</h4>
                        <Badge variant="success" size="sm">{classifiedCount}</Badge>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {sortedCategories.map((category) => (
                          <IntakeCategoryCard
                            key={category}
                            category={category}
                            documents={docsByCategory.get(category) ?? []}
                            projectId={projectId}
                            onReclassified={() => undefined}
                            dpgfAlreadyImported={category === "dpgf" ? true : undefined}
                            plansSynced={category === "plans" ? true : undefined}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              ) : null}

              {card.kind === "primary" ? (
                <div className="space-y-4">
                  <section aria-label="Choix principal">
                    <div className="mb-2 flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-700" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 8v4" />
                        <path d="M12 16h.01" />
                      </svg>
                      <h4 className="text-xs font-semibold text-amber-900">Choisir le document principal</h4>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {sortedCategories
                        .filter((category) => category === "dpgf" || category === "cctp")
                        .map((category) => (
                          <IntakeCategoryCard
                            key={category}
                            category={category}
                            documents={docsByCategory.get(category) ?? []}
                            projectId={projectId}
                            onReclassified={() => undefined}
                            dpgfAlreadyImported={category === "dpgf" ? true : undefined}
                          />
                        ))}
                    </div>
                  </section>
                </div>
              ) : null}

              {card.kind === "brief" || card.kind === "structure" || card.kind === "plans" ? (
                <div className="space-y-4">
                  {sortedCategories.length > 0 ? (
                    <section aria-label="Documents classés par catégorie">
                      <div className="mb-2 flex items-center gap-2">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-emerald-700" aria-hidden="true">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                          <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                        <h4 className="text-xs font-semibold text-emerald-900">Valides</h4>
                        <Badge variant="success" size="sm">{classifiedCount}</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {sortedCategories.map((category) => (
                          <IntakeCategoryCard
                            key={category}
                            category={category}
                            documents={docsByCategory.get(category) ?? []}
                            projectId={projectId}
                            onReclassified={() => undefined}
                            dpgfAlreadyImported={category === "dpgf" ? true : undefined}
                            plansSynced={category === "plans" ? true : undefined}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}

                  <div className={`rounded-xl border px-4 py-4 ${stateToneClassName}`}>
                    <div className="min-w-0">
                      <h4 className="text-base font-semibold text-[var(--slate-900)]">{card.title}</h4>
                      <p className="mt-1 text-sm leading-6 text-[var(--slate-700)]">{card.message}</p>
                      {evidence.length > 0 ? (
                        <ul className="mt-3 grid gap-1.5">
                          {evidence.map((line) => (
                            <li key={line} className="text-sm text-[var(--slate-700)]">
                              {line}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {totalCount > 0 &&
              reviewCount === 0 &&
              processingCount === 0 &&
              card.kind !== "missing" &&
              card.kind !== "primary" &&
              (intakeWorkspace?.missingPieces.length ?? 0) === 0 ? (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--success)]/20 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  Triage termine — Tous les documents sont valides.
                </div>
              ) : null}
              {totalCount > 0 && (reviewCount > 0 || processingCount > 0) ? (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] px-3 py-2 text-sm text-[var(--slate-600)]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" x2="12" y1="8" y2="12" />
                    <line x1="12" x2="12.01" y1="16" y2="16" />
                  </svg>
                  {card.kind === "review"
                    ? `${reviewCount + processingCount} document${reviewCount + processingCount > 1 ? "s" : ""} a revoir dans le dossier.`
                    : `Triage en cours — ${reviewCount + processingCount} document${reviewCount + processingCount > 1 ? "s" : ""} restent a confirmer.`}
                </div>
              ) : null}
            </div>
            ) : null}
          </div>
        </div>

        <div className="pointer-events-none absolute right-1 top-5 z-20 h-6 w-28 rotate-45 rounded-sm border border-orange-500 bg-orange-400 px-1 py-0.5 opacity-90 shadow-lg sm:right-5 sm:top-10 sm:h-8 sm:w-44">
          <div className="h-px w-full bg-orange-200 sm:h-[2px]" />
          <div className="mt-1 flex justify-between px-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={`ruler-result-${index}`} className="h-2 w-px bg-orange-200 sm:h-3 sm:w-[2px]" />
            ))}
          </div>
          <div className="mt-1 h-px w-full bg-orange-200 sm:h-[2px]" />
        </div>

        <div className="pointer-events-none absolute bottom-7 left-2 z-20 flex h-4 w-24 -rotate-12 items-center rounded-full border border-yellow-500 bg-yellow-400 shadow-lg sm:bottom-10 sm:left-6 sm:h-5 sm:w-40">
          <div className="h-full w-4 rounded-l-full bg-slate-800 sm:w-6" />
          <div className="absolute top-[1px] h-px w-full bg-yellow-600/50 sm:top-[2px] sm:h-[2px]" />
          <div className="absolute bottom-[1px] h-px w-full bg-yellow-600/50 sm:bottom-[2px] sm:h-[2px]" />
          <div className="ml-auto h-full w-4 rounded-r-full border-l border-yellow-500 bg-pink-400 sm:w-6" />
        </div>
      </div>
    </div>
  );
}

export function AffaireFlowHierarchyPanel(
  props: Readonly<AffaireFlowHierarchyPanelProps>,
) {
  const [isEmptyUploadDragActive, setIsEmptyUploadDragActive] = useState(false);
  const model = buildPanelModel(props);
  const manualEstimateHref = buildManualEstimateHref({
    projectId: props.projectId,
    currentVersion: props.currentVersion,
  });
  const readinessBadge = getHubReadinessBadge({
    hubReadiness: props.hubReadiness ?? null,
    fallback: model.readinessLevel,
  });
  const handleOpenIntakeUpload = () => {
    dispatchCockpitOpenSurface({
      projectId: props.projectId,
      actionId: "flow-empty-upload",
      surfaceId: "intake-upload",
      triggerFilePicker: true,
    });
  };

  const handleEmptyUploadDrop = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsEmptyUploadDragActive(false);

    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length === 0) return;

    dispatchCockpitOpenSurface({
      projectId: props.projectId,
      actionId: "flow-empty-upload",
      surfaceId: "intake-upload",
      files,
    });
  };

  return (
    <section className="rounded-2xl border border-[var(--slate-200)] bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,0.96))] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--slate-500)]">
            Prochaine etape
          </p>
          {model.showEmptyUploadCard || model.resultCard ? null : (
            <>
              <h2 className="mt-2 text-base font-semibold text-[var(--slate-900)] text-balance">
                {model.title}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--slate-600)]">{model.summary}</p>
            </>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge variant={model.statusVariant} size="sm" withDot>
            {model.statusLabel}
          </Badge>
          <Badge variant={readinessBadge.variant} size="sm" withDot>
            {readinessBadge.label}
          </Badge>
        </div>
      </div>

      {model.showEmptyUploadCard ? (
        <div className="mt-4 space-y-4">
          <button
            type="button"
            onClick={handleOpenIntakeUpload}
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsEmptyUploadDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (
                event.relatedTarget instanceof Node &&
                event.currentTarget.contains(event.relatedTarget)
              ) {
                return;
              }
              setIsEmptyUploadDragActive(false);
            }}
            onDrop={handleEmptyUploadDrop}
            className="group block w-full text-left"
            aria-label="Deposer les pieces pour lancer l'analyse"
          >
            <div className="relative overflow-hidden rounded-[1.5rem] border border-[#d5c6af] bg-[#e8dcc9] p-4 sm:p-6">
              <div
                className={`relative min-h-[20rem] overflow-hidden rounded-[1rem] border-2 border-dashed bg-[var(--foreground)] shadow-[0_24px_60px_rgba(15,23,42,0.28)] transition duration-300 sm:min-h-[24rem] ${
                  isEmptyUploadDragActive
                    ? "scale-[1.01] border-sky-300 ring-4 ring-sky-300/35"
                    : "border-white/45 group-hover:scale-[1.01]"
                }`}
              >
                <div
                  className="absolute inset-0 opacity-45"
                  style={{
                    backgroundImage:
                      "linear-gradient(rgba(255,255,255,0.24) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.24) 1px, transparent 1px)",
                    backgroundSize: "24px 24px",
                  }}
                />
                <svg
                  viewBox="0 0 800 600"
                  className="absolute inset-0 h-full w-full text-white/12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M140 90h480v330H140z" />
                  <path d="M230 150h160v140H230z" />
                  <path d="M420 150h170" />
                  <path d="M420 220h170" />
                  <path d="M420 290c38 0 66 10 84 30" />
                  <path d="M230 390h360" />
                  <path d="M230 460h240" />
                  <path d="M200 140v320" />
                  <path d="M640 120v290" />
                  <path d="M280 120v-28" />
                  <path d="M560 120v-28" />
                </svg>

                <div className="relative z-10 flex min-h-[20rem] flex-col items-center justify-center px-6 py-8 text-center sm:min-h-[24rem]">
                  <div className="mb-4 text-white/90 transition-transform duration-300 group-hover:scale-110">
                    <svg
                      className="h-16 w-16"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth="1.5"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                      />
                    </svg>
                  </div>

                  <h3 className="max-w-3xl text-2xl font-bold text-white sm:text-4xl">
                    {isEmptyUploadDragActive
                      ? "Relachez pour importer vos pieces"
                      : "Deposez vos pieces ici"}
                  </h3>
                  <p className="mt-3 text-sm font-medium text-sky-50 sm:text-lg">
                    CCTP, DPGF, plans, courriers
                  </p>

                  <div className="mt-6">
                    <span className="btn btn-secondary btn-sm border-white/35 bg-white/15 text-white hover:bg-white/25">
                      Selectionner les fichiers
                    </span>
                  </div>
                  <p className="mt-3 text-xs font-medium uppercase tracking-[0.14em] text-sky-50/88 sm:text-sm">
                    PDF, images, Excel, Word - 50 Mo max par fichier
                  </p>
                </div>
              </div>

              <div className="pointer-events-none absolute right-1 top-5 z-20 h-6 w-28 rotate-45 rounded-sm border border-orange-500 bg-orange-400 px-1 py-0.5 opacity-90 shadow-lg sm:right-5 sm:top-10 sm:h-8 sm:w-44">
                <div className="h-px w-full bg-orange-200 sm:h-[2px]" />
                <div className="mt-1 flex justify-between px-2">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div key={`ruler-${index}`} className="h-2 w-px bg-orange-200 sm:h-3 sm:w-[2px]" />
                  ))}
                </div>
                <div className="mt-1 h-px w-full bg-orange-200 sm:h-[2px]" />
              </div>

              <div className="pointer-events-none absolute bottom-7 left-2 z-20 flex h-4 w-24 -rotate-12 items-center rounded-full border border-yellow-500 bg-yellow-400 shadow-lg sm:bottom-10 sm:left-6 sm:h-5 sm:w-40">
                <div className="h-full w-4 rounded-l-full bg-slate-800 sm:w-6" />
                <div className="absolute top-[1px] h-px w-full bg-yellow-600/50 sm:top-[2px] sm:h-[2px]" />
                <div className="absolute bottom-[1px] h-px w-full bg-yellow-600/50 sm:bottom-[2px] sm:h-[2px]" />
                <div className="ml-auto h-full w-4 rounded-r-full border-l border-yellow-500 bg-pink-400 sm:w-6" />
              </div>
            </div>
          </button>
          <div className="rounded-2xl border border-[var(--slate-200)] bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[var(--slate-800)]">
                  Le mode manuel reste disponible
                </h3>
                <p className="mt-1 text-sm leading-6 text-[var(--slate-600)]">
                  Vous pouvez ouvrir le devis sans DPGF et completer la structure plus tard.
                </p>
              </div>
              <Link href={manualEstimateHref} className="btn btn-secondary btn-sm shrink-0">
                Continuer en manuel
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {model.resultCard ? (
        <ResultCard
          projectId={props.projectId}
          card={model.resultCard}
          intakeWorkspace={props.intakeWorkspace}
          onOpenIntakeUpload={handleOpenIntakeUpload}
          onExecuteSuggestion={props.onExecuteSuggestion}
        />
      ) : null}

      {!model.resultCard && model.primaryAction ? (
        <div className="mt-4 rounded-2xl border border-[var(--brand-blue)]/15 bg-[var(--brand-blue)]/5 p-4">
          <p className="text-sm font-medium text-[var(--slate-700)]">
            Continuez depuis l&apos;affaire avec une action dominante, puis ouvrez d&apos;autres
            surfaces seulement si le contexte l&apos;exige.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ActionButton
              action={model.primaryAction}
              onExecuteSuggestion={props.onExecuteSuggestion}
            />
            <p className="text-xs leading-5 text-[var(--slate-500)]">
              {model.primaryAction.description}
            </p>
          </div>
        </div>
      ) : null}

      {model.blockers.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-[var(--warning)]/20 bg-[var(--warning)]/6 p-4">
          <h3 className="text-sm font-semibold text-[var(--slate-800)]">Blocages a traiter</h3>
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {model.blockers.map((blocker) => (
              <li
                key={blocker}
                className="rounded-xl border border-white/80 bg-white/85 px-3 py-2 text-sm text-[var(--slate-600)]"
              >
                {blocker}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {model.aides.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-[var(--slate-200)] bg-white p-4">
          <h3 className="text-sm font-semibold text-[var(--slate-800)]">
            Outils utiles si besoin
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--slate-600)]">
            Ces aides restent secondaires. Ouvrez-les seulement si elles accelerent une decision ou
            une preparation utile maintenant.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {model.aides.map((action) => (
              <ActionButton
                key={action.key}
                action={action}
                onExecuteSuggestion={props.onExecuteSuggestion}
              />
            ))}
          </div>
        </div>
      ) : null}

      {model.legacyAction ? (
        <div className="mt-4 rounded-2xl border border-[var(--warning)]/20 bg-[var(--warning)]/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[var(--slate-800)]">Reprise legacy</h3>
              <p className="mt-1 text-sm leading-6 text-[var(--slate-600)]">
                {model.legacyAction.description}
              </p>
            </div>
            <ActionButton action={model.legacyAction} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
