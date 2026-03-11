import Link from "next/link";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import { buildAffaireRegisterHubHref, type AffaireRegisterSummary } from "@/lib/affaires/register";
import type {
  AffaireHubDpgfSourceResult,
  AffaireHubFinishLineSummaryResult,
} from "@/lib/affaires/server";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";
import type { CockpitSurfaceId } from "@/lib/cockpit/suggestions";
import type { AffaireHubPlansSummaryData } from "./PlansMetresCard";

type PilotageStepStatus = "done" | "in_progress" | "blocked" | "waiting";
type PilotageExceptionSeverity = "critical" | "warning" | "info";

type PilotageStep = {
  key: "dossier" | "brief" | "devis" | "metre" | "validation";
  label: string;
  status: PilotageStepStatus;
  summary: string;
};

type PilotageAction =
  | {
      kind: "href";
      label: string;
      href: string;
    }
  | {
      kind: "surface";
      label: string;
      surfaceId: CockpitSurfaceId;
    };

type PilotageException = {
  id: string;
  title: string;
  summary: string;
  severity: PilotageExceptionSeverity;
  action: PilotageAction;
};

type AffairePilotagePanelProps = {
  projectId: string;
  intakeWorkspace: Pick<
    AffaireIntakeWorkspace,
    "documents" | "missingPieces" | "briefDraft"
  > | null;
  dpgfSource: AffaireHubDpgfSourceResult;
  plansSummary: AffaireHubPlansSummaryData | null;
  registerSummary: AffaireRegisterSummary | null;
  approvalSummary: EstimateApprovalSummary | null;
  currentVersion:
    | {
        id: string;
        status: string;
        versionNumber: number;
      }
    | null;
  lineCount: number;
  finishLineSummary?: AffaireHubFinishLineSummaryResult | null;
  takeoffEnabled?: boolean;
  onOpenSurface?: (surfaceId: CockpitSurfaceId) => void;
};

type FinishLineCard = {
  key: "send" | "order";
  label: string;
  status: "ready" | "blocked" | "warning" | "waiting" | "unavailable";
  summary: string;
  details: string[];
  action: PilotageAction | null;
};

function hasValidatedDpgfMapping(dpgfSource: AffaireHubDpgfSourceResult) {
  return (
    dpgfSource !== null &&
    dpgfSource.importStatus === "completed" &&
    (dpgfSource.mappingStatus === null ||
      dpgfSource.mappingStatus === "validated" ||
      dpgfSource.mappingStatus === "applied")
  );
}

function isDocumentProcessing(
  document: NonNullable<AffairePilotagePanelProps["intakeWorkspace"]>["documents"][number],
) {
  return (
    document.confidence === 0 &&
    document.detectedCategory === "a_classer" &&
    document.issues.length === 0
  );
}

function isDocumentNeedingReview(
  document: NonNullable<AffairePilotagePanelProps["intakeWorkspace"]>["documents"][number],
) {
  return (
    !isDocumentProcessing(document) &&
    (document.detectedCategory === "a_classer" || document.confidence < 0.65)
  );
}

function buildTakeoffExceptionsHref(projectId: string, plansSummary: AffaireHubPlansSummaryData) {
  const latestJob = plansSummary.latestJob;
  if (!latestJob) {
    return `/dashboard/affaires/${projectId}/takeoff`;
  }

  return `/dashboard/affaires/${projectId}/takeoff/${latestJob.jobId}/review?versionId=${latestJob.reviewVersionId}&view=dpgf&dpgfView=exceptions_only`;
}

function getStepBadgeVariant(status: PilotageStepStatus) {
  switch (status) {
    case "done":
      return "success";
    case "in_progress":
      return "info";
    case "blocked":
      return "error";
    case "waiting":
      return "neutral";
  }
}

function getStepBadgeLabel(status: PilotageStepStatus) {
  switch (status) {
    case "done":
      return "Termine";
    case "in_progress":
      return "En cours";
    case "blocked":
      return "Bloque";
    case "waiting":
      return "En attente";
  }
}

function getExceptionBadgeVariant(severity: PilotageExceptionSeverity) {
  switch (severity) {
    case "critical":
      return "error";
    case "warning":
      return "warning";
    case "info":
      return "info";
  }
}

function getExceptionBadgeLabel(severity: PilotageExceptionSeverity) {
  switch (severity) {
    case "critical":
      return "Priorite";
    case "warning":
      return "A verifier";
    case "info":
      return "A preparer";
  }
}

function getFinishLineBadgeVariant(status: FinishLineCard["status"]) {
  switch (status) {
    case "ready":
      return "success";
    case "blocked":
      return "error";
    case "warning":
      return "warning";
    case "waiting":
    case "unavailable":
      return "neutral";
  }
}

function getFinishLineBadgeLabel(status: FinishLineCard["status"]) {
  switch (status) {
    case "ready":
      return "Pret";
    case "blocked":
      return "Bloque";
    case "warning":
      return "A surveiller";
    case "waiting":
      return "En attente";
    case "unavailable":
      return "Indisponible";
  }
}

function buildEstimateVersionHref(
  currentVersion: AffairePilotagePanelProps["currentVersion"]
) {
  if (!currentVersion) return null;
  return currentVersion.status === "draft"
    ? `/dashboard/estimates/${currentVersion.id}/edit`
    : `/dashboard/estimates/${currentVersion.id}`;
}

function buildReadyToSendAction(input: {
  projectId: string;
  currentVersion: AffairePilotagePanelProps["currentVersion"];
  finishLineSummary: AffaireHubFinishLineSummaryResult | null | undefined;
}) {
  if (!input.currentVersion) {
    return {
      kind: "href" as const,
      label: "Creer un devis",
      href: `/dashboard/estimates/new?projectId=${input.projectId}`,
    };
  }

  const blockingFlag = input.finishLineSummary?.readyToSend.blockingFlags[0] ?? null;
  if (blockingFlag?.key === "critical_open_questions") {
    return {
      kind: "href" as const,
      label: "Ouvrir le registre",
      href: `${buildAffaireRegisterHubHref({
        projectId: input.projectId,
        status: "open",
        severity: "critical",
      })}#register`,
    };
  }

  if (blockingFlag?.key === "client_clarification_required") {
    return {
      kind: "href" as const,
      label: "Ouvrir le registre",
      href: `${buildAffaireRegisterHubHref({
        projectId: input.projectId,
        status: "clarify_with_client",
        severity: null,
      })}#register`,
    };
  }

  if (blockingFlag?.key === "open_questions_pending") {
    return {
      kind: "href" as const,
      label: "Ouvrir le registre",
      href: `${buildAffaireRegisterHubHref({
        projectId: input.projectId,
        status: "open",
        severity: null,
      })}#register`,
    };
  }

  if (blockingFlag?.key === "no_pdf_generated" && input.currentVersion) {
    return {
      kind: "href" as const,
      label: "Generer le PDF",
      href: `/dashboard/estimates/${input.currentVersion.id}/print`,
    };
  }

  const versionHref = buildEstimateVersionHref(input.currentVersion);
  if (!versionHref) {
    return null;
  }

  return {
    kind: "href" as const,
    label: "Reprendre le devis",
    href: versionHref,
  };
}

function buildReadyToOrderAction(input: {
  projectId: string;
  currentVersion: AffairePilotagePanelProps["currentVersion"];
  finishLineSummary: AffaireHubFinishLineSummaryResult | null | undefined;
}) {
  const pricesHref = `/dashboard/affaires/${input.projectId}/prices`;

  if (!input.currentVersion) {
    return {
      kind: "href" as const,
      label: "Importer des prix fournisseurs",
      href: pricesHref,
    };
  }

  const order = input.finishLineSummary?.readyToOrder ?? null;
  if (
    !order ||
    order.status === "waiting" ||
    order.missingPriceLinesCount > 0 ||
    order.staleLinesCount > 0
  ) {
    return {
      kind: "href" as const,
      label:
        order && (order.coveredLinesCount > 0 || order.staleLinesCount > 0)
          ? "Mettre a jour les prix fournisseurs"
          : "Importer des prix fournisseurs",
      href: pricesHref,
    };
  }

  const versionHref = buildEstimateVersionHref(input.currentVersion);
  if (!versionHref) {
    return {
      kind: "href" as const,
      label: "Importer des prix fournisseurs",
      href: pricesHref,
    };
  }

  return {
    kind: "href" as const,
    label: "Revoir les fournisseurs",
    href: versionHref,
  };
}

function buildFinishLineCards(input: {
  projectId: string;
  currentVersion: AffairePilotagePanelProps["currentVersion"];
  finishLineSummary: AffaireHubFinishLineSummaryResult | null | undefined;
}) {
  if (!input.currentVersion) {
    return [
      {
        key: "send",
        label: "Pret a envoyer",
        status: "waiting",
        summary: "La sortie devis apparait une fois un premier devis brouillon cree.",
        details: ["Creez une version de devis pour verifier la sortie client."],
        action: buildReadyToSendAction(input),
      },
      {
        key: "order",
        label: "Pret a commander",
        status: "waiting",
        summary: "La preparation commandes devient lisible quand les lignes fournisseur existent.",
        details: ["Les achats restent prepares manuellement depuis l'affaire."],
        action: buildReadyToOrderAction({
          projectId: input.projectId,
          currentVersion: input.currentVersion,
          finishLineSummary: input.finishLineSummary,
        }),
      },
    ] satisfies FinishLineCard[];
  }

  if (!input.finishLineSummary) {
    return [
      {
        key: "send",
        label: "Pret a envoyer",
        status: "unavailable",
        summary: "La verification de sortie devis est indisponible pour le moment.",
        details: ["Rechargez la page ou reprenez le devis pour continuer."],
        action: buildReadyToSendAction(input),
      },
      {
        key: "order",
        label: "Pret a commander",
        status: "unavailable",
        summary: "La verification achats est indisponible pour le moment.",
        details: ["Rechargez la page avant de preparer les commandes."],
        action: buildReadyToOrderAction({
          projectId: input.projectId,
          currentVersion: input.currentVersion,
          finishLineSummary: input.finishLineSummary,
        }),
      },
    ] satisfies FinishLineCard[];
  }

  const readyToSendDetails = [
    ...input.finishLineSummary.readyToSend.blockingFlags.map((flag) => flag.label),
    ...input.finishLineSummary.readyToSend.warningFlags.map((flag) => flag.label),
  ].slice(0, 3);

  const readyToSendCard: FinishLineCard = {
    key: "send",
    label: "Pret a envoyer",
    status: input.finishLineSummary.readyToSend.status,
    summary:
      input.finishLineSummary.readyToSend.status === "ready"
        ? "Le devis peut sortir sans etape cachee supplementaire."
        : input.finishLineSummary.readyToSend.status === "warning"
          ? `${input.finishLineSummary.readyToSend.warningFlags.length} vigilance${input.finishLineSummary.readyToSend.warningFlags.length > 1 ? "s" : ""} a assumer avant l'envoi.`
          : input.finishLineSummary.readyToSend.status === "blocked"
            ? `${input.finishLineSummary.readyToSend.blockingFlags.length} blocage${input.finishLineSummary.readyToSend.blockingFlags.length > 1 ? "s" : ""} metier a lever avant l'envoi.`
            : input.finishLineSummary.readyToSend.errorMessage ??
              "La sortie devis reste en attente.",
    details:
      readyToSendDetails.length > 0
        ? readyToSendDetails
        : ["Aucun blocage metier n'est remonte sur la sortie devis."],
    action: buildReadyToSendAction(input),
  };

  const order = input.finishLineSummary.readyToOrder;
  const readyToOrderDetails = [
    order.missingPriceLinesCount > 0
      ? `${order.missingPriceLinesCount} ligne${order.missingPriceLinesCount > 1 ? "s" : ""} sans fournisseur retenu`
      : null,
    order.ambiguousLinesCount > 0
      ? `${order.ambiguousLinesCount} ligne${order.ambiguousLinesCount > 1 ? "s" : ""} a arbitrer`
      : null,
    order.staleLinesCount > 0
      ? `${order.staleLinesCount} prix fournisseur${order.staleLinesCount > 1 ? "s" : ""} a revalider`
      : null,
  ].filter((detail): detail is string => detail !== null);

  const readyToOrderCard: FinishLineCard = {
    key: "order",
    label: "Pret a commander",
    status: order.status,
    summary:
      order.status === "ready"
        ? `${order.coveredLinesCount} ligne${order.coveredLinesCount > 1 ? "s" : ""} fournisseur preparable${order.coveredLinesCount > 1 ? "s" : ""} sans ressaisie.`
        : order.status === "waiting"
          ? "Aucune ligne fournisseur n'est encore identifiable pour preparer des commandes."
          : order.status === "blocked"
            ? `${order.orderableLinesCount - order.coveredLinesCount} ligne${order.orderableLinesCount - order.coveredLinesCount > 1 ? "s" : ""} reste${order.orderableLinesCount - order.coveredLinesCount > 1 ? "nt" : ""} a fiabiliser avant la preparation achats.`
            : order.errorMessage ?? "La preparation achats reste indisponible.",
    details:
      readyToOrderDetails.length > 0
        ? readyToOrderDetails
        : order.status === "ready"
          ? ["Les lignes fournisseur sont couvertes a cette etape."]
          : [order.errorMessage ?? "Les commandes restent preparees manuellement."],
    action: buildReadyToOrderAction({
      projectId: input.projectId,
      currentVersion: input.currentVersion,
      finishLineSummary: input.finishLineSummary,
    }),
  };

  return [readyToSendCard, readyToOrderCard] satisfies FinishLineCard[];
}

function countDocumentsNeedingReview(
  intakeWorkspace: AffairePilotagePanelProps["intakeWorkspace"],
) {
  if (!intakeWorkspace) {
    return 0;
  }

  return intakeWorkspace.documents.filter(isDocumentNeedingReview).length;
}

function countDocumentsProcessing(
  intakeWorkspace: AffairePilotagePanelProps["intakeWorkspace"],
) {
  if (!intakeWorkspace) {
    return 0;
  }

  return intakeWorkspace.documents.filter(isDocumentProcessing).length;
}

function buildPilotageSteps(input: {
  intakeWorkspace: AffairePilotagePanelProps["intakeWorkspace"];
  dpgfSource: AffaireHubDpgfSourceResult;
  plansSummary: AffaireHubPlansSummaryData | null;
  approvalSummary: EstimateApprovalSummary | null;
  currentVersion: AffairePilotagePanelProps["currentVersion"];
  lineCount: number;
  takeoffEnabled: boolean;
}) {
  const documentsCount = input.intakeWorkspace?.documents.length ?? 0;
  const reviewDocumentsCount = countDocumentsNeedingReview(input.intakeWorkspace);
  const processingDocumentsCount = countDocumentsProcessing(input.intakeWorkspace);
  const criticalMissingPiecesCount =
    input.intakeWorkspace?.missingPieces.filter((piece) => piece.severity === "critical")
      .length ?? 0;
  const missingPiecesCount = input.intakeWorkspace?.missingPieces.length ?? 0;
  const briefStatus = input.intakeWorkspace?.briefDraft?.status ?? null;
  const hasConfirmedBrief = briefStatus === "confirme";
  const latestJob = input.plansSummary?.latestJob ?? null;
  const takeoffCoverageAvailable =
    input.plansSummary?.coveragePercent != null &&
    input.plansSummary?.exceptionCount != null;

  const dossierSummaryParts: string[] = [];
  let dossierStatus: PilotageStepStatus = "waiting";
  if (documentsCount === 0) {
    dossierSummaryParts.push("Deposez les pieces du dossier pour lancer le cadrage.");
  } else if (processingDocumentsCount > 0) {
    dossierStatus = "in_progress";
    dossierSummaryParts.push(
      `${processingDocumentsCount} piece${processingDocumentsCount > 1 ? "s" : ""} en cours de tri.`,
    );
  } else if (reviewDocumentsCount > 0 || criticalMissingPiecesCount > 0) {
    dossierStatus = "blocked";
    if (reviewDocumentsCount > 0) {
      dossierSummaryParts.push(
        `${reviewDocumentsCount} piece${reviewDocumentsCount > 1 ? "s" : ""} a confirmer.`,
      );
    }
    if (criticalMissingPiecesCount > 0) {
      dossierSummaryParts.push(
        `${criticalMissingPiecesCount} piece${criticalMissingPiecesCount > 1 ? "s" : ""} critique${criticalMissingPiecesCount > 1 ? "s" : ""} manquante${criticalMissingPiecesCount > 1 ? "s" : ""}.`,
      );
    }
  } else if (missingPiecesCount > 0) {
    dossierStatus = "in_progress";
    dossierSummaryParts.push(
      `${missingPiecesCount} piece${missingPiecesCount > 1 ? "s" : ""} utile${missingPiecesCount > 1 ? "s" : ""} a ajouter.`,
    );
  } else {
    dossierStatus = "done";
    dossierSummaryParts.push("Dossier trie, classe et exploitable.");
  }

  let briefStep: PilotageStep;
  if (documentsCount === 0) {
    briefStep = {
      key: "brief",
      label: "Brief",
      status: "waiting",
      summary: "Le brief apparait une fois les pieces du dossier deposees.",
    };
  } else if (input.intakeWorkspace?.briefDraft === null) {
    briefStep = {
      key: "brief",
      label: "Brief",
      status: "in_progress",
      summary: "Le brief se construit a partir des pieces detectees.",
    };
  } else if (briefStatus === "a_confirmer") {
    briefStep = {
      key: "brief",
      label: "Brief",
      status: "blocked",
      summary: "Confirmez les hypotheses, vigilances et manques avant la suite.",
    };
  } else {
    briefStep = {
      key: "brief",
      label: "Brief",
      status: "done",
      summary: "Brief confirme, hypotheses et points de vigilance poses.",
    };
  }

  let devisStep: PilotageStep;
  if (input.dpgfSource === null) {
    devisStep = {
      key: "devis",
      label: "Structure devis",
      status: hasConfirmedBrief ? "waiting" : "waiting",
      summary: "Importez le DPGF pour materialiser une base de devis.",
    };
  } else if (input.dpgfSource.importStatus === "failed") {
    devisStep = {
      key: "devis",
      label: "Structure devis",
      status: "blocked",
      summary: "Le DPGF doit etre corrige avant de poursuivre la structuration.",
    };
  } else if (
    input.dpgfSource.importStatus !== "completed" ||
    (input.dpgfSource.mappingStatus !== null &&
      input.dpgfSource.mappingStatus !== "validated" &&
      input.dpgfSource.mappingStatus !== "applied")
  ) {
    devisStep = {
      key: "devis",
      label: "Structure devis",
      status: "in_progress",
      summary: "Le DPGF est en cours d'import ou de validation.",
    };
  } else if (input.lineCount === 0) {
    devisStep = {
      key: "devis",
      label: "Structure devis",
      status: "in_progress",
      summary: "La structure est prete, il reste a materialiser les lignes utiles.",
    };
  } else {
    devisStep = {
      key: "devis",
      label: "Structure devis",
      status: "done",
      summary: `${input.lineCount} ligne${input.lineCount > 1 ? "s" : ""} de devis disponible${input.lineCount > 1 ? "s" : ""}.`,
    };
  }

  let metreStep: PilotageStep;
  if (!input.takeoffEnabled) {
    metreStep = {
      key: "metre",
      label: "Metre & preuves",
      status: "waiting",
      summary: "Le metre assiste n'est pas active pour cette affaire.",
    };
  } else if ((input.plansSummary?.planSetCount ?? 0) === 0) {
    metreStep = {
      key: "metre",
      label: "Metre & preuves",
      status: "waiting",
      summary: "Ajoutez des plans pour lancer l'analyse et comparer les quantites.",
    };
  } else if (latestJob?.status === "action_required") {
    metreStep = {
      key: "metre",
      label: "Metre & preuves",
      status: "blocked",
      summary:
        input.plansSummary?.failureReasonLabel ??
        "Une action est requise avant de reprendre l'analyse des plans.",
    };
  } else if (latestJob?.status === "review_required") {
    const exceptionCount = input.plansSummary?.exceptionCount;
    metreStep = {
      key: "metre",
      label: "Metre & preuves",
      status: "blocked",
      summary:
        typeof exceptionCount === "number" && exceptionCount > 0
          ? `${exceptionCount} ecart${exceptionCount > 1 ? "s" : ""} majeur${exceptionCount > 1 ? "s" : ""} a revoir.`
          : takeoffCoverageAvailable
            ? "La revue des metres reste requise avant d'appliquer les quantites dans le devis."
            : "La revue des metres reste requise, mais le resume compare est indisponible.",
    };
  } else if (
    latestJob &&
    (latestJob.status === "queued" ||
      latestJob.status === "processing" ||
      latestJob.status === "provider_pending")
  ) {
    metreStep = {
      key: "metre",
      label: "Metre & preuves",
      status: "in_progress",
      summary: `${latestJob.label}.`,
    };
  } else if ((input.plansSummary?.exceptionCount ?? 0) > 0) {
    metreStep = {
      key: "metre",
      label: "Metre & preuves",
      status: "blocked",
      summary: `${input.plansSummary?.exceptionCount ?? 0} ecart${(input.plansSummary?.exceptionCount ?? 0) > 1 ? "s" : ""} majeur${(input.plansSummary?.exceptionCount ?? 0) > 1 ? "s" : ""} a revoir.`,
    };
  } else if (latestJob && latestJob.status === "completed") {
    const coveragePercent = input.plansSummary?.coveragePercent;
    metreStep = {
      key: "metre",
      label: "Metre & preuves",
      status: "done",
      summary:
        typeof coveragePercent === "number"
          ? `${coveragePercent} % des postes sont couverts par l'analyse.`
          : "Analyse des plans disponible dans l'affaire.",
    };
  } else {
    metreStep = {
      key: "metre",
      label: "Metre & preuves",
      status: "in_progress",
      summary: "Les plans sont synchronises et l'analyse peut etre relancee.",
    };
  }

  let validationStep: PilotageStep;
  if (input.currentVersion === null || input.lineCount === 0) {
    validationStep = {
      key: "validation",
      label: "Validation & sortie",
      status: "waiting",
      summary: "La sortie du devis se prepare quand la structure est stabilisee.",
    };
  } else if (input.currentVersion.status === "sent" || input.currentVersion.status === "accepted") {
    validationStep = {
      key: "validation",
      label: "Validation & sortie",
      status: "done",
      summary:
        input.currentVersion.status === "accepted"
          ? `Version ${input.currentVersion.versionNumber} acceptee.`
          : `Version ${input.currentVersion.versionNumber} envoyee.`,
    };
  } else if (input.approvalSummary?.approvalStatus === "approved" || input.approvalSummary?.approvalStatus === "not_required") {
    validationStep = {
      key: "validation",
      label: "Validation & sortie",
      status: "done",
      summary: "Le devis est pret a sortir sans validation supplementaire.",
    };
  } else if (input.approvalSummary?.approvalStatus === "in_review") {
    validationStep = {
      key: "validation",
      label: "Validation & sortie",
      status: "in_progress",
      summary: "La demande de validation est en cours de revue.",
    };
  } else if (input.approvalSummary?.approvalStatus === "changes_requested") {
    validationStep = {
      key: "validation",
      label: "Validation & sortie",
      status: "blocked",
      summary: "Des corrections sont attendues avant l'envoi du devis.",
    };
  } else {
    validationStep = {
      key: "validation",
      label: "Validation & sortie",
      status: "waiting",
      summary: "Le devis est a preparer pour validation ou envoi.",
    };
  }

  return [
    {
      key: "dossier",
      label: "Dossier",
      status: dossierStatus,
      summary: dossierSummaryParts.join(" "),
    },
    briefStep,
    devisStep,
    metreStep,
    validationStep,
  ] satisfies PilotageStep[];
}

function buildPilotageExceptions(input: {
  projectId: string;
  intakeWorkspace: AffairePilotagePanelProps["intakeWorkspace"];
  dpgfSource: AffaireHubDpgfSourceResult;
  plansSummary: AffaireHubPlansSummaryData | null;
  registerSummary: AffaireRegisterSummary | null;
  approvalSummary: EstimateApprovalSummary | null;
  allowSurfaceActions?: boolean;
}) {
  const exceptions: PilotageException[] = [];
  const reviewDocumentsCount = countDocumentsNeedingReview(input.intakeWorkspace);
  const criticalMissingPiecesCount =
    input.intakeWorkspace?.missingPieces.filter((piece) => piece.severity === "critical")
      .length ?? 0;
  const missingPiecesCount = input.intakeWorkspace?.missingPieces.length ?? 0;
  const allowSurfaceActions = input.allowSurfaceActions ?? true;

  if (reviewDocumentsCount > 0) {
    exceptions.push({
      id: "intake-review",
      title: `Confirmer ${reviewDocumentsCount} piece${reviewDocumentsCount > 1 ? "s" : ""} ambigu${reviewDocumentsCount > 1 ? "es" : "e"}`,
      summary:
        "Classez les documents a revoir pour eviter de propager une mauvaise interpretation du dossier.",
      severity: "warning",
      action: {
        kind: "href",
        label: "Ouvrir les pieces a revoir",
        href: `/dashboard/affaires/${input.projectId}?intakeFilter=a_revoir#intake`,
      },
    });
  }

  if (missingPiecesCount > 0 && allowSurfaceActions) {
    exceptions.push({
      id: "missing-pieces",
      title: `Ajouter ${missingPiecesCount} piece${missingPiecesCount > 1 ? "s" : ""} manquante${missingPiecesCount > 1 ? "s" : ""}`,
      summary:
        criticalMissingPiecesCount > 0
          ? "Le dossier reste incomplet sur des pieces critiques."
          : "Le dossier peut avancer, mais certaines pieces restent utiles pour fiabiliser la suite.",
      severity: criticalMissingPiecesCount > 0 ? "critical" : "info",
      action: {
        kind: "surface",
        label: "Ajouter des pieces",
        surfaceId: "intake-upload",
      },
    });
  }

  if (input.intakeWorkspace?.briefDraft?.status === "a_confirmer" && allowSurfaceActions) {
    exceptions.push({
      id: "brief-confirm",
      title: "Confirmer le brief affaire",
      summary:
        "Validez ou corrigez hypotheses, points de vigilance et manques avant les automations aval.",
      severity: "warning",
      action: {
        kind: "surface",
        label: "Ouvrir le brief",
        surfaceId: "brief-confirm",
      },
    });
  }

  if (input.dpgfSource?.importStatus === "failed") {
    exceptions.push({
      id: "dpgf-import-failed",
      title: "Corriger l'import du DPGF",
      summary:
        "Le dernier import du DPGF a echoue. Reprenez cette etape avant de structurer le devis.",
      severity: "critical",
      action: {
        kind: "href",
        label: "Voir le DPGF",
        href: "#dpgf",
      },
    });
  } else if (input.dpgfSource !== null && !hasValidatedDpgfMapping(input.dpgfSource)) {
    exceptions.push({
      id: "dpgf-mapping-pending",
      title: "Finaliser la structure du devis",
      summary:
        "Le DPGF est importe mais son mapping doit etre valide avant de poursuivre le chiffrage.",
      severity: "warning",
      action: {
        kind: "href",
        label: "Verifier le DPGF",
        href: "#dpgf",
      },
    });
  }

  if ((input.registerSummary?.criticalOpenCount ?? 0) > 0) {
    const count = input.registerSummary?.criticalOpenCount ?? 0;
    exceptions.push({
      id: "register-critical",
      title: `${count} point${count > 1 ? "s" : ""} critique${count > 1 ? "s" : ""} a arbitrer`,
      summary:
        "Traitez d'abord les points qui bloquent la lecture fiable du dossier ou la suite du chiffrage.",
      severity: "critical",
      action: {
        kind: "href",
        label: "Ouvrir le registre",
        href: `${buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: "open",
          severity: "critical",
        })}#register`,
      },
    });
  } else if ((input.registerSummary?.openQuestionsCount ?? 0) > 0) {
    const count = input.registerSummary?.openQuestionsCount ?? 0;
    exceptions.push({
      id: "register-open",
      title: `${count} point${count > 1 ? "s" : ""} registre en attente`,
      summary:
        "Le registre concentre les hypotheses et clarifications encore ouvertes dans l'affaire.",
      severity: "warning",
      action: {
        kind: "href",
        label: "Voir le registre",
        href: `${buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: "open",
          severity: null,
        })}#register`,
      },
    });
  }

  if (input.plansSummary?.latestJob?.status === "action_required") {
    exceptions.push({
      id: "takeoff-action-required",
      title: "Relancer ou corriger l'analyse des plans",
      summary:
        input.plansSummary.failureReasonLabel ??
        "Le metre ne peut pas continuer sans action de votre part.",
      severity: "critical",
      action: {
        kind: "href",
        label: "Voir l'analyse",
        href: `/dashboard/affaires/${input.projectId}/takeoff`,
      },
    });
  } else if (
    (input.plansSummary?.exceptionCount ?? 0) > 0 &&
    input.plansSummary?.latestJob &&
    (input.plansSummary.latestJob.status === "completed" ||
      input.plansSummary.latestJob.status === "review_required")
  ) {
    const count = input.plansSummary.exceptionCount ?? 0;
    exceptions.push({
      id: "takeoff-exceptions",
      title: `${count} ecart${count > 1 ? "s" : ""} majeur${count > 1 ? "s" : ""} sur les metres`,
      summary:
        "Revoyez les preuves et les ecarts avant d'appliquer les quantites dans le devis.",
      severity: "critical",
      action: {
        kind: "href",
        label: "Revoir les exceptions",
        href: buildTakeoffExceptionsHref(input.projectId, input.plansSummary),
      },
    });
  } else if (input.plansSummary?.latestJob?.status === "review_required") {
    exceptions.push({
      id: "takeoff-review-required",
      title: "Revoir l'analyse des plans",
      summary:
        "Le backend signale qu'une revue reste requise avant d'exploiter les metres dans le devis.",
      severity: "warning",
      action: {
        kind: "href",
        label: "Ouvrir la revue",
        href: buildTakeoffExceptionsHref(input.projectId, input.plansSummary),
      },
    });
  } else if (
    input.plansSummary &&
    input.plansSummary.planSetCount > 0 &&
    input.plansSummary.latestJob === null &&
    allowSurfaceActions
  ) {
    exceptions.push({
      id: "takeoff-launch",
      title: "Lancer l'analyse des plans",
      summary:
        "Les plans sont deja presents dans l'affaire. Il reste a demarrer le metre pour comparer les quantites.",
      severity: "info",
      action: {
        kind: "surface",
        label: "Demarrer l'analyse",
        surfaceId: "launch-metre",
      },
    });
  }

  if (input.approvalSummary?.approvalStatus === "changes_requested") {
    exceptions.push({
      id: "approval-rejected",
      title: "Corriger avant validation",
      summary:
        "La direction a demande des ajustements avant de poursuivre la sortie du devis.",
      severity: "warning",
      action: {
        kind: "href",
        label: "Ouvrir la validation",
        href: "#approval",
      },
    });
  }

  const severityRank: Record<PilotageExceptionSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };

  return exceptions.sort((left, right) => {
    const severityDiff = severityRank[left.severity] - severityRank[right.severity];
    if (severityDiff !== 0) {
      return severityDiff;
    }

    return left.title.localeCompare(right.title, "fr");
  });
}

function ExceptionActionButton({
  action,
  onOpenSurface,
}: {
  action: PilotageAction;
  onOpenSurface?: AffairePilotagePanelProps["onOpenSurface"];
}) {
  if (action.kind === "href") {
    return (
      <Link
        href={action.href}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--brand-blue)] transition-colors hover:text-[var(--brand-blue-dark)]"
      >
        {action.label}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      </Link>
    );
  }

  if (!onOpenSurface) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => onOpenSurface(action.surfaceId)}
      className="inline-flex items-center gap-1.5 text-left text-sm font-medium text-[var(--brand-blue)] transition-colors hover:text-[var(--brand-blue-dark)]"
    >
      {action.label}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </svg>
    </button>
  );
}

export function AffairePilotagePanel({
  projectId,
  intakeWorkspace,
  dpgfSource,
  plansSummary,
  registerSummary,
  approvalSummary,
  currentVersion,
  lineCount,
  finishLineSummary,
  takeoffEnabled = false,
  onOpenSurface,
}: AffairePilotagePanelProps) {
  const allowSurfaceActions = typeof onOpenSurface === "function";
  const steps = buildPilotageSteps({
    intakeWorkspace,
    dpgfSource,
    plansSummary,
    approvalSummary,
    currentVersion,
    lineCount,
    takeoffEnabled,
  });
  const exceptions = buildPilotageExceptions({
    projectId,
    intakeWorkspace,
    dpgfSource,
    plansSummary,
    registerSummary,
    approvalSummary,
    allowSurfaceActions,
  });
  const finishLineCards = buildFinishLineCards({
    projectId,
    currentVersion,
    finishLineSummary,
  });

  return (
    <section className="dashboard-card p-5 animate-fade-in">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">
            Pilotage de l&apos;affaire
          </h2>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            La vue par defaut remonte ce qui bloque vraiment et indique ou reprendre.
          </p>
        </div>
        <Badge
          variant={exceptions.length > 0 ? "warning" : "success"}
          size="sm"
          withDot
          className="self-start"
        >
          {exceptions.length > 0
            ? `${exceptions.length} point${exceptions.length > 1 ? "s" : ""} a traiter`
            : "Aucun blocage prioritaire"}
        </Badge>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        {finishLineCards.map((card) => (
          <div
            key={card.key}
            className="rounded-2xl border border-[var(--slate-200)] bg-white p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--slate-500)]">
                  Finish line
                </p>
                <h3 className="mt-2 text-sm font-semibold text-[var(--slate-800)]">
                  {card.label}
                </h3>
              </div>
              <Badge variant={getFinishLineBadgeVariant(card.status)} size="sm" withDot>
                {getFinishLineBadgeLabel(card.status)}
              </Badge>
            </div>

            <p className="mt-3 text-sm leading-6 text-[var(--slate-600)]">
              {card.summary}
            </p>

            <ul className="mt-3 space-y-2">
              {card.details.map((detail) => (
                <li
                  key={`${card.key}-${detail}`}
                  className="rounded-lg bg-[var(--slate-50)] px-3 py-2 text-sm text-[var(--slate-600)]"
                >
                  {detail}
                </li>
              ))}
            </ul>

            {card.action ? (
              <div className="mt-4">
                <ExceptionActionButton action={card.action} onOpenSurface={onOpenSurface} />
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-[var(--slate-200)] bg-[var(--slate-50)]/70 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--slate-800)]">
              Timeline du flux principal
            </h3>
            <span className="text-xs text-[var(--slate-400)]">
              Etat reconstruit depuis l&apos;affaire
            </span>
          </div>

          <ol className="space-y-3">
            {steps.map((step, index) => (
              <li key={step.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={`mt-1 flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold ${
                      step.status === "done"
                        ? "border-[var(--success)] bg-[var(--success)]/10 text-[var(--success)]"
                        : step.status === "blocked"
                          ? "border-[var(--danger)] bg-[var(--danger)]/10 text-[var(--danger)]"
                          : step.status === "in_progress"
                            ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]"
                            : "border-[var(--slate-200)] bg-white text-[var(--slate-400)]"
                    }`}
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  {index < steps.length - 1 ? (
                    <span
                      className={`mt-2 h-full min-h-10 w-px ${
                        step.status === "done"
                          ? "bg-[var(--success)]/30"
                          : "bg-[var(--slate-200)]"
                      }`}
                      aria-hidden="true"
                    />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1 rounded-xl border border-[var(--slate-200)] bg-white px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-[var(--slate-800)]">
                      {step.label}
                    </p>
                    <Badge variant={getStepBadgeVariant(step.status)} size="sm" withDot>
                      {getStepBadgeLabel(step.status)}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-[var(--slate-600)]">
                    {step.summary}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-2xl border border-[var(--slate-200)] bg-white p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--slate-800)]">
              Exceptions a traiter
            </h3>
            <span className="text-xs text-[var(--slate-400)]">
              Priorise par impact
            </span>
          </div>

          {exceptions.length === 0 ? (
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
                  <circle cx="12" cy="12" r="10" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              }
              title="Rien d'urgent a reprendre"
              description="Le dossier peut avancer sans repasser par une revue exhaustive."
              className="border border-dashed border-[var(--slate-200)] bg-[var(--slate-50)]/70 py-10"
            />
          ) : (
            <ul className="space-y-3">
              {exceptions.map((exception) => (
                <li
                  key={exception.id}
                  className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)]/70 px-3 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={getExceptionBadgeVariant(exception.severity)}
                      size="sm"
                      withDot
                    >
                      {getExceptionBadgeLabel(exception.severity)}
                    </Badge>
                    <p className="text-sm font-semibold text-[var(--slate-800)]">
                      {exception.title}
                    </p>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-[var(--slate-600)]">
                    {exception.summary}
                  </p>
                  <div className="mt-3">
                    <ExceptionActionButton
                      action={exception.action}
                      onOpenSurface={onOpenSurface}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export {
  buildFinishLineCards,
  buildPilotageExceptions,
  buildPilotageSteps,
  buildTakeoffExceptionsHref,
};
