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
} from "@/lib/affaires/intake";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import type { AffaireHubFinishLineSummaryResult, AffaireHubSummaryResult } from "@/lib/affaires/server";
import type { CockpitSuggestion } from "@/lib/cockpit/suggestions";
import { dispatchCockpitOpenSurface } from "@/lib/cockpit/events";
import type { VersionZeroDraftSummary } from "@/lib/estimates/client";

import type { AffaireHubPlansSummaryData } from "./PlansMetresCard";
import { IntakeCategoryCard, categorySort } from "./IntakeCategoryCard";
import { IntakeDocumentCard } from "./IntakeDocumentCard";

type AffaireFlowHierarchyPanelProps = {
  projectId: string;
  currentVersion: AffaireHubSummaryResult["currentVersion"] | null;
  versionZeroSummary?: VersionZeroDraftSummary | null;
  takeoffEnabled?: boolean;
  plansSummary?: AffaireHubPlansSummaryData | null;
  intakeWorkspace?: (Pick<AffaireIntakeWorkspace, "missingPieces" | "documents"> & {
    briefDraft?: AffaireIntakeWorkspace["briefDraft"];
  }) | null;
  finishLineSummary?: AffaireHubFinishLineSummaryResult | null;
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
      action: PanelAction;
      facts: string[];
      evidence: string[];
    }
  | {
      kind: "primary";
      title: string;
      message: string;
      action: PanelAction | null;
      facts: string[];
      evidence?: string[];
    }
  | {
      kind: "missing";
      title: string;
      message: string;
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

function dedupe(values: string[]) {
  return [...new Set(values)];
}

function isStructureResumeAction(action: PanelAction) {
  const label = action.label.toLowerCase();
  return label.includes("revoir") || label.includes("reprendre");
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

function findSuggestion(
  suggestions: CockpitSuggestion[],
  intent: CockpitSuggestion["intent"],
) {
  return suggestions.find((suggestion) => suggestion.intent === intent) ?? null;
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
  const finishLineBlockers =
    input.finishLineSummary?.readyToSend.blockingFlags.map((flag) => flag.label) ?? [];
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
  const viewExceptionsSuggestion = findSuggestion(suggestions, "view_exceptions");
  const prepareValidationSuggestion = findSuggestion(suggestions, "prepare_validation");

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
  const reviewCouldResolveCriticalMissing =
    reviewDocument !== null &&
    getReviewProbableCategories(reviewDocument).some((category) =>
      hasCriticalMissingCategory(missingPieces, category),
    );

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
    title = "Verifier les documents recus";
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
    statusLabel = "Reference principale a definir";
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
    title = "Completer le dossier";
    summary =
      criticalMissingPieces.length > 0
        ? `Ajoutez d'abord ${count} piece${count > 1 ? "s" : ""} critique${count > 1 ? "s" : ""} avant de lancer le metre ou de finaliser la sortie devis.`
        : `Le dossier reste incomplet. Ajoutez les pieces manquantes avant de poursuivre le chiffrage.`;
    statusLabel = "Dossier incomplet";
    statusVariant = "warning";
    heroState = "missing";
    readinessLevel = "not_ready";
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
      title: "Dossier incomplet",
      message:
        !hasDpgf && !hasPlans
          ? "Il manque la base devis et les plans pour lancer l'analyse."
          : !hasDpgf
            ? "Les plans sont presents, mais il manque encore la base devis."
            : "La base devis est prete, mais il manque encore les plans techniques.",
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
      confirmBriefSuggestion?.preview ??
      "Valider le cadrage du dossier pour debloquer la suite du chiffrage assiste.";
    statusLabel = "Brief a valider";
    statusVariant = "info";
    heroState = "brief";
    readinessLevel = "ready_with_reservations";
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
      title: "Dossier exploitable",
      message:
        "Les pieces critiques sont presentes. Confirmez le cadrage metier avant de chiffrer.",
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
    statusLabel = "Pret pour analyse";
    statusVariant = "success";
    heroState = "plans";
    readinessLevel = "ready";
    primaryAction = toSuggestionAction(analyzePlansSuggestion);
    resultCard = {
      kind: "plans",
      title: "Structure prete",
      message: "Lancez l'analyse des plans pour extraire les quantites.",
      action: primaryAction,
      facts: dedupe([
        hasPlans ? "Plans detectes" : "",
        hasDpgf ? "Base devis prete" : "",
      ]).filter(Boolean),
    };
  } else if (generateStructureSuggestion) {
    const hasStructureDraft = generateStructureSuggestion.label
      .toLowerCase()
      .includes("revoir");
    title = generateStructureSuggestion.label;
    summary = generateStructureSuggestion.preview;
    statusLabel = hasStructureDraft ? "Structure a reprendre" : "Structure a generer";
    statusVariant = "success";
    heroState = "structure";
    readinessLevel = "ready_with_reservations";
    primaryAction = toSuggestionAction(generateStructureSuggestion);
    resultCard = {
      kind: "structure",
      title: "Brief confirme",
      message: hasStructureDraft
        ? "Le brief est confirme. Reprenez la structure du devis avant de materialiser le chiffrage."
        : "Le brief est confirme. Generez la structure du devis pour lancer le chiffrage.",
      action: primaryAction,
      facts: dedupe([
        hasDpgf ? "Base devis prete" : "",
        hasPlans ? "Plans detectes" : "",
        "Version brouillon disponible",
      ]).filter(Boolean),
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
    input.finishLineSummary &&
    (input.finishLineSummary.readyToSend.status === "ready" ||
      input.finishLineSummary.readyToSend.status === "warning")
  ) {
    title = "Verifier la sortie devis";
    summary = "Le chiffrage est assez stable pour verifier le PDF, l'email et la sortie client.";
    statusLabel = "Sortie a finaliser";
    statusVariant = "success";
    heroState = "ready_to_continue";
    readinessLevel =
      input.finishLineSummary.readyToSend.status === "ready" ? "ready" : "ready_with_reservations";
    primaryAction = toHrefAction({
      key: "finish-line-output",
      label: "Ouvrir la sortie devis",
      description: "Verifier le PDF, l'email et les derniers points avant envoi.",
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

  const allowSecondaryAides = heroState === "ready_to_continue";
  const aides: PanelAction[] = [];
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
        description: "Verifier le jeu de plans retenu avant analyse ou revue.",
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

function getFileIllustrationTone(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") {
    return { label: "PDF", accent: "text-red-600", frame: "border-red-200 bg-red-50/90" };
  }
  if (["xlsx", "xls", "csv"].includes(ext)) {
    return { label: "XLS", accent: "text-emerald-700", frame: "border-emerald-200 bg-emerald-50/90" };
  }
  if (["doc", "docx"].includes(ext)) {
    return { label: "DOC", accent: "text-blue-700", frame: "border-blue-200 bg-blue-50/90" };
  }
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) {
    return { label: "IMG", accent: "text-fuchsia-700", frame: "border-fuchsia-200 bg-fuchsia-50/90" };
  }
  if (["eml", "msg"].includes(ext)) {
    return { label: "MSG", accent: "text-slate-700", frame: "border-slate-200 bg-slate-50/90" };
  }
  return { label: "FILE", accent: "text-slate-600", frame: "border-slate-200 bg-white/90" };
}

function getCategoryIllustrationLabel(category: string) {
  if (category === "dpgf") return "DPGF";
  if (category === "plans") return "Plans";
  if (category === "cctp") return "CCTP";
  if (category === "bpu_dqe") return "BPU/DQE";
  if (category === "emails") return "Courriers";
  if (category === "annexes") return "Annexes";
  return "A classer";
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

function getReviewProbableCategories(
  document: NonNullable<AffaireFlowHierarchyPanelProps["intakeWorkspace"]>["documents"][number] | null,
) {
  if (!document) {
    return ["plans", "cctp", "annexes"];
  }

  const extension = document.fileName.split(".").pop()?.toLowerCase() ?? "";
  const baseCategories = ["plans", "cctp", "annexes"];
  if (["xlsx", "xls", "csv"].includes(extension)) {
    return ["dpgf", "bpu_dqe", "annexes"];
  }
  if (["doc", "docx"].includes(extension)) {
    return ["cctp", "annexes", "emails"];
  }
  if (["eml", "msg"].includes(extension)) {
    return ["emails", "annexes", "cctp"];
  }
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(extension)) {
    return ["plans", "annexes", "cctp"];
  }
  return baseCategories;
}

function getMissingReviewKinds(
  missingPieces: NonNullable<AffaireFlowHierarchyPanelProps["intakeWorkspace"]>["missingPieces"],
) {
  const kinds = new Set<string>();

  for (const piece of missingPieces) {
    const normalized = `${piece.code} ${piece.label}`.toLowerCase();
    if (normalized.includes("dpgf")) {
      kinds.add("dpgf");
    }
    if (normalized.includes("plan")) {
      kinds.add("plans");
    }
    if (normalized.includes("cctp")) {
      kinds.add("cctp");
    }
  }

  return kinds;
}

function sortReviewDocuments(
  documents: NonNullable<AffaireFlowHierarchyPanelProps["intakeWorkspace"]>["documents"],
  missingPieces: NonNullable<AffaireFlowHierarchyPanelProps["intakeWorkspace"]>["missingPieces"],
) {
  const missingKinds = getMissingReviewKinds(missingPieces);

  return [...documents]
    .filter((document) => isDocumentNeedingReview(document))
    .sort((left, right) => {
      const leftProbables = getReviewProbableCategories(left);
      const rightProbables = getReviewProbableCategories(right);
      const leftResolvesCritical = leftProbables.some((category) => missingKinds.has(category));
      const rightResolvesCritical = rightProbables.some((category) => missingKinds.has(category));

      if (leftResolvesCritical !== rightResolvesCritical) {
        return leftResolvesCritical ? -1 : 1;
      }

      if (left.confidence !== right.confidence) {
        return left.confidence - right.confidence;
      }

      return left.fileName.localeCompare(right.fileName);
    });
}

function getReviewEvidenceHints(
  document: NonNullable<AffaireFlowHierarchyPanelProps["intakeWorkspace"]>["documents"][number] | null,
  missingPieces: NonNullable<AffaireFlowHierarchyPanelProps["intakeWorkspace"]>["missingPieces"] = [],
) {
  if (!document) {
    return ["Piece recue", "Aucune categorie certaine", "Verification manuelle requise"];
  }

  const extension = document.fileName.split(".").pop()?.toLowerCase() ?? "";
  const fileTypeHint =
    extension === "pdf"
      ? "PDF recu"
      : ["xlsx", "xls", "csv"].includes(extension)
        ? "Tableur recu"
        : ["doc", "docx"].includes(extension)
          ? "Document texte recu"
          : ["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(extension)
            ? "Image recue"
            : "Piece recue";

  const missingKinds = getMissingReviewKinds(missingPieces);
  const probableCategories = getReviewProbableCategories(document);
  const liftedBlockingHint = probableCategories.find((category) => missingKinds.has(category));
  const liftHint =
    liftedBlockingHint === "dpgf"
      ? "Peut lever: DPGF manquant"
      : liftedBlockingHint === "plans"
        ? "Peut lever: Plans manquants"
        : liftedBlockingHint === "cctp"
          ? "Peut lever: CCTP manquant"
          : "";

  return dedupe([
    fileTypeHint,
    `${Math.round(document.confidence * 100)}% de confiance`,
    document.confidence < 0.65 ? "Aucune categorie certaine" : "",
    liftHint,
    document.issues[0] ?? "",
  ]).filter(Boolean);
}

function getReviewChoiceLabel(input: {
  category: string;
  hasPrimaryDpgf: boolean;
  hasPrimaryCctp: boolean;
}) {
  if (input.category === "dpgf") {
    return input.hasPrimaryDpgf ? "DPGF" : "DPGF";
  }
  if (input.category === "cctp") {
    return input.hasPrimaryCctp ? "CCTP" : "CCTP";
  }

  return getCategoryIllustrationLabel(input.category);
}

function getReviewChoiceSecondaryBadge(input: {
  category: string;
  hasPrimaryDpgf: boolean;
  hasPrimaryCctp: boolean;
}) {
  if (input.category === "dpgf" && input.hasPrimaryDpgf) {
    return "Complementaire";
  }
  if (input.category === "cctp" && input.hasPrimaryCctp) {
    return "Complementaire";
  }

  return null;
}

function getReviewChoiceConsequence(input: {
  category: string;
  hasPrimaryDpgf: boolean;
  hasPrimaryCctp: boolean;
}) {
  const { category, hasPrimaryDpgf, hasPrimaryCctp } = input;
  if (category === "plans") {
    return "La piece integrera le centre plans et pourra nourrir le metre.";
  }
  if (category === "cctp") {
    return hasPrimaryCctp
      ? "La piece sera ajoutee comme CCTP complementaire sans remplacer le principal."
      : "La piece deviendra le CCTP principal pour le cadrage et le brief metier.";
  }
  if (category === "dpgf") {
    return hasPrimaryDpgf
      ? "La piece sera ajoutee comme DPGF complementaire sans remplacer le principal."
      : "La piece deviendra le DPGF principal pour la structure et le chiffrage.";
  }
  if (category === "bpu_dqe") {
    return "La piece restera exploitable comme base de prix ou de quantites.";
  }
  if (category === "emails") {
    return "La piece restera disponible comme contexte contractuel secondaire.";
  }
  return "La piece restera disponible comme document secondaire du dossier.";
}

function getStateWhyContent(card: PanelResultCard) {
  const isStructureResumeCard =
    card.kind === "structure" && isStructureResumeAction(card.action);

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
    return {
      title: "Le dossier est exploitable, mais le cadrage metier doit etre valide avant de structurer le devis.",
      hints: [...card.facts.slice(0, 2), ...(card.evidence ?? []).slice(0, 1)],
    };
  }
  if (card.kind === "structure") {
    return {
      title: isStructureResumeCard
        ? "Le brief est confirme. La prochaine action est de reprendre la structure du devis."
        : "Le brief est confirme. La prochaine action est de generer la structure du devis.",
      hints: card.facts.slice(0, 3),
    };
  }
  return {
    title: "La base devis et les plans sont prets. Le metre peut demarrer depuis cette etape.",
    hints: card.facts.slice(0, 3),
  };
}

function getStateHeroBadgeLabel(card: PanelResultCard) {
  if (card.kind === "primary") return "Reference principale a definir";
  if (card.kind === "missing") return "Pieces critiques manquantes";
  if (card.kind === "brief") return "Dossier exploitable";
  if (card.kind === "structure") {
    return isStructureResumeAction(card.action)
      ? "Structure a reprendre"
      : "Structure a generer";
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
        : "Detail de la piece active a confirmer"
      : card.kind === "primary"
        ? `${classifiedDpgfCount > 0 ? `${classifiedDpgfCount} DPGF` : ""}${classifiedDpgfCount > 0 && classifiedCctpCount > 0 ? " / " : ""}${classifiedCctpCount > 0 ? `${classifiedCctpCount} CCTP` : ""} a arbitrer`
      : card.kind === "missing"
        ? `${classifiedCount} piece${classifiedCount > 1 ? "s" : ""} deja recue${classifiedCount > 1 ? "s" : ""}`
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
          ? "border-sky-200 bg-sky-50"
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
                            <span>{getReviewChoiceLabel({ category, hasPrimaryDpgf, hasPrimaryCctp })}</span>
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
                          {isReviewActionPending ? "Confirmation..." : "Confirmer la categorie"}
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
                      ? "Pieces deja recues"
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
                    <section aria-label="Contexte deja classe">
                      <div className="mb-2 flex items-center gap-2">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-emerald-700" aria-hidden="true">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                          <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                        <h4 className="text-xs font-semibold text-emerald-900">Contexte deja classe</h4>
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
                    <section aria-label="Pieces deja recues">
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
                    <section aria-label="Documents classes par categorie">
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
  const model = buildPanelModel(props);
  const handleOpenIntakeUpload = () => {
    dispatchCockpitOpenSurface({
      projectId: props.projectId,
      actionId: "flow-empty-upload",
      surfaceId: "intake-upload",
      triggerFilePicker: true,
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
        <Badge variant={model.statusVariant} size="sm" withDot>
          {model.statusLabel}
        </Badge>
      </div>

      {model.showEmptyUploadCard ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={handleOpenIntakeUpload}
            className="group block w-full text-left"
            aria-label="Deposer les pieces pour lancer l'analyse"
          >
            <div className="relative overflow-hidden rounded-[1.5rem] border border-[#d5c6af] bg-[#e8dcc9] p-4 sm:p-6">
              <div className="relative min-h-[20rem] overflow-hidden rounded-[1rem] border-2 border-dashed border-white/45 bg-[var(--foreground)] shadow-[0_24px_60px_rgba(15,23,42,0.28)] transition-transform duration-300 group-hover:scale-[1.01] sm:min-h-[24rem]">
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
                    Deposez vos pieces ici
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
