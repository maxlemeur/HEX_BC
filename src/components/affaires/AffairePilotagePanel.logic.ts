import {
  isAffaireIntakeDocumentNeedingReview,
  isAffaireIntakeDocumentProcessing,
} from "@/lib/affaires/intake";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import { buildAffaireRegisterHubHref, type AffaireRegisterSummary } from "@/lib/affaires/register";
import type {
  AffaireHubDpgfSourceResult,
  AffaireHubFinishLineSummaryResult,
} from "@/lib/affaires/server";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";
import type { CockpitSurfaceId } from "@/lib/cockpit/suggestions";
import type { AffaireHubPlansSummaryData } from "./PlansMetresCard";

export type PilotageStepStatus = "done" | "in_progress" | "blocked" | "waiting";
export type PilotageExceptionSeverity = "critical" | "warning" | "info";

export type PilotageStep = {
  key: "dossier" | "brief" | "devis" | "metre" | "validation";
  label: string;
  status: PilotageStepStatus;
  summary: string;
};

export type PilotageAction =
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

export type PilotageException = {
  id: string;
  title: string;
  summary: string;
  severity: PilotageExceptionSeverity;
  action: PilotageAction;
};

export type AffairePilotageWorkspace = Pick<
  AffaireIntakeWorkspace,
  "documents" | "missingPieces" | "briefDraft"
> | null;

export type AffairePilotageCurrentVersion =
  | {
      id: string;
      status: string;
      versionNumber: number;
    }
  | null;

export type FinishLineCard = {
  key: "send" | "order";
  label: string;
  status: "ready" | "blocked" | "warning" | "waiting" | "unavailable";
  summary: string;
  details: string[];
  action: PilotageAction | null;
};

export type FinishLineReadiness = {
  reveal: boolean;
  title: string;
  summary: string;
  blockers: string[];
};

type ReadyToSendBlockingFlag =
  NonNullable<AffaireHubFinishLineSummaryResult>["readyToSend"]["blockingFlags"][number];

function isDocumentRegisterFlagKey(
  key: ReadyToSendBlockingFlag["key"],
) {
  return (
    key === "critical_missing_pieces" ||
    key === "client_missing_documents_required" ||
    key === "missing_pieces_pending"
  );
}

function isClarificationRegisterFlagKey(
  key: ReadyToSendBlockingFlag["key"],
) {
  return (
    key === "critical_open_questions" ||
    key === "client_clarification_required" ||
    key === "open_questions_pending"
  );
}

function resolveBlockingFlagRegisterStatus(
  key: ReadyToSendBlockingFlag["key"],
) {
  return key === "client_missing_documents_required" ||
    key === "client_clarification_required"
    ? "clarify_with_client"
    : "open";
}

function resolveBlockingFlagRegisterSeverity(
  key: ReadyToSendBlockingFlag["key"],
) {
  return key === "critical_missing_pieces" || key === "critical_open_questions"
    ? "critical"
    : null;
}

export function isPdfFinishLineFlag(flag: ReadyToSendBlockingFlag) {
  return flag.category === "pdf" || flag.key === "no_pdf_generated";
}

function buildRegisterActionFromBlockingFlag(input: {
  projectId: string;
  flag: ReadyToSendBlockingFlag;
}) {
  const { flag, projectId } = input;
  const status = resolveBlockingFlagRegisterStatus(flag.key);
  const severity = resolveBlockingFlagRegisterSeverity(flag.key);

  if (flag.category === "documents" || (!flag.category && isDocumentRegisterFlagKey(flag.key))) {
    return {
      kind: "href" as const,
      label:
        status === "clarify_with_client"
          ? "Ouvrir les documents attendus"
          : "Ouvrir les documents manquants",
      href: `${buildAffaireRegisterHubHref({
        projectId,
        status,
        severity,
        kind: "missing_piece",
      })}#register`,
    };
  }

  if (
    flag.category === "register" ||
    (!flag.category && isClarificationRegisterFlagKey(flag.key))
  ) {
    return {
      kind: "href" as const,
      label:
        status === "clarify_with_client"
          ? "Ouvrir les clarifications client"
          : "Ouvrir le registre",
      href: `${buildAffaireRegisterHubHref({
        projectId,
        status,
        severity,
        kind: "assumption",
      })}#register`,
    };
  }

  return null;
}

function isRegisterExceptionCoveringSendBlocker(
  flag: ReadyToSendBlockingFlag,
  exceptionIds: ReadonlySet<string>,
) {
  if (flag.category === "documents" || (!flag.category && isDocumentRegisterFlagKey(flag.key))) {
    if (flag.key === "critical_missing_pieces") {
      return exceptionIds.has("missing-pieces") || exceptionIds.has("register-critical");
    }

    return exceptionIds.has("missing-pieces") || exceptionIds.has("register-open");
  }

  if (
    flag.category === "register" ||
    (!flag.category && isClarificationRegisterFlagKey(flag.key))
  ) {
    if (flag.key === "critical_open_questions") {
      return exceptionIds.has("register-critical");
    }

    return exceptionIds.has("register-open") || exceptionIds.has("register-critical");
  }

  return false;
}

export function countPrioritizedFinishLineBlockers(input: {
  finishLineCards: FinishLineCard[];
  finishLineSummary: AffaireHubFinishLineSummaryResult | null | undefined;
  exceptions: PilotageException[];
}) {
  const exceptionIds = new Set(input.exceptions.map((exception) => exception.id));

  return input.finishLineCards.reduce((count, card) => {
    if (card.status !== "blocked") {
      return count;
    }

    if (card.key !== "send" || !input.finishLineSummary) {
      return count + 1;
    }

    const hasDistinctBlocker = input.finishLineSummary.readyToSend.blockingFlags.some(
      (flag) => !isRegisterExceptionCoveringSendBlocker(flag, exceptionIds)
    );

    return count + (hasDistinctBlocker ? 1 : 0);
  }, 0);
}

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
  document: NonNullable<AffairePilotageWorkspace>["documents"][number],
) {
  return isAffaireIntakeDocumentProcessing(document);
}

function isDocumentNeedingReview(
  document: NonNullable<AffairePilotageWorkspace>["documents"][number],
) {
  return isAffaireIntakeDocumentNeedingReview(document);
}

export function buildTakeoffExceptionsHref(
  projectId: string,
  plansSummary: AffaireHubPlansSummaryData
) {
  const latestJob = plansSummary.latestJob;
  if (!latestJob) {
    return `/dashboard/affaires/${projectId}/takeoff`;
  }

  return `/dashboard/affaires/${projectId}/takeoff/${latestJob.jobId}/review?versionId=${latestJob.reviewVersionId}&view=dpgf&dpgfView=exceptions_only`;
}

function buildEstimateVersionHref(currentVersion: AffairePilotageCurrentVersion) {
  if (!currentVersion) {
    return null;
  }

  return currentVersion.status === "draft"
    ? `/dashboard/estimates/${currentVersion.id}/edit`
    : `/dashboard/estimates/${currentVersion.id}`;
}

export function buildReadyToSendAction(input: {
  projectId: string;
  currentVersion: AffairePilotageCurrentVersion;
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
  const registerAction =
    blockingFlag === null
      ? null
      : buildRegisterActionFromBlockingFlag({
          projectId: input.projectId,
          flag: blockingFlag,
        });
  if (registerAction) {
    return registerAction;
  }

  if (blockingFlag && isPdfFinishLineFlag(blockingFlag) && input.currentVersion) {
    return {
      kind: "href" as const,
      label: "Ouvrir la sortie devis",
      href: "#finish-line-output",
    };
  }

  if (
    input.currentVersion &&
    input.finishLineSummary &&
    (input.finishLineSummary.readyToSend.status === "ready" ||
      input.finishLineSummary.readyToSend.status === "warning")
  ) {
    return {
      kind: "href" as const,
      label: "Ouvrir la sortie devis",
      href: "#finish-line-output",
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

export function buildReadyToOrderAction(input: {
  projectId: string;
  currentVersion: AffairePilotageCurrentVersion;
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
  if (order?.status === "ready") {
    return {
      kind: "href" as const,
      label: "Ouvrir la finish line commandes",
      href: "#finish-line-orders",
    };
  }

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

export function buildFinishLineCards(input: {
  projectId: string;
  currentVersion: AffairePilotageCurrentVersion;
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
        action: buildReadyToOrderAction(input),
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
        action: buildReadyToOrderAction(input),
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
    action: buildReadyToOrderAction(input),
  };

  return [readyToSendCard, readyToOrderCard] satisfies FinishLineCard[];
}

export function buildFinishLineReadiness(input: {
  intakeWorkspace: AffairePilotageWorkspace;
  dpgfSource: AffaireHubDpgfSourceResult;
  currentVersion: AffairePilotageCurrentVersion;
  lineCount: number;
}) {
  const blockers: string[] = [];
  const reviewDocumentsCount = countDocumentsNeedingReview(input.intakeWorkspace);
  const criticalMissingPiecesCount =
    input.intakeWorkspace?.missingPieces.filter((piece) => piece.severity === "critical")
      .length ?? 0;

  if (reviewDocumentsCount > 0) {
    blockers.push(
      `${reviewDocumentsCount} piece${reviewDocumentsCount > 1 ? "s" : ""} reste${reviewDocumentsCount > 1 ? "nt" : ""} a confirmer dans le dossier.`,
    );
  }

  if (criticalMissingPiecesCount > 0) {
    blockers.push(
      `${criticalMissingPiecesCount} piece${criticalMissingPiecesCount > 1 ? "s critiques manquantes" : " critique manquante"} avant la sortie.`,
    );
  }

  if (input.dpgfSource === null) {
    blockers.push("Importez puis validez le DPGF avant de preparer la sortie.");
  } else if (!hasValidatedDpgfMapping(input.dpgfSource)) {
    blockers.push("Validez le DPGF avant d'ouvrir la sortie devis.");
  }

  if (input.currentVersion === null) {
    blockers.push("Creez un premier devis brouillon pour materialiser la sortie.");
  } else if (input.lineCount === 0) {
    blockers.push("Materialisez au moins une ligne de devis exploitable.");
  }

  if (blockers.length === 0) {
    return {
      reveal: true,
      title: "Sortie devis et achats",
      summary:
        "Le dossier est assez mature pour afficher la sortie devis, l'email client, le BDC et la preparation achats.",
      blockers: [],
    } satisfies FinishLineReadiness;
  }

  return {
    reveal: false,
    title: "Sortie devis masquee pour l'instant",
    summary:
      "PDF, email, BDC et commandes apparaitront seulement quand la structure devis sera exploitable sans ambiguite.",
    blockers: blockers.slice(0, 3),
  } satisfies FinishLineReadiness;
}

function countDocumentsNeedingReview(intakeWorkspace: AffairePilotageWorkspace) {
  if (!intakeWorkspace) {
    return 0;
  }

  return intakeWorkspace.documents.filter(isDocumentNeedingReview).length;
}

function countDocumentsProcessing(intakeWorkspace: AffairePilotageWorkspace) {
  if (!intakeWorkspace) {
    return 0;
  }

  return intakeWorkspace.documents.filter(isDocumentProcessing).length;
}

export function buildPilotageSteps(input: {
  intakeWorkspace: AffairePilotageWorkspace;
  dpgfSource: AffaireHubDpgfSourceResult;
  plansSummary: AffaireHubPlansSummaryData | null;
  approvalSummary: EstimateApprovalSummary | null;
  currentVersion: AffairePilotageCurrentVersion;
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
  } else if (
    input.currentVersion.status === "sent" ||
    input.currentVersion.status === "accepted"
  ) {
    validationStep = {
      key: "validation",
      label: "Validation & sortie",
      status: "done",
      summary:
        input.currentVersion.status === "accepted"
          ? `Version ${input.currentVersion.versionNumber} acceptee.`
          : `Version ${input.currentVersion.versionNumber} envoyee.`,
    };
  } else if (
    input.approvalSummary?.approvalStatus === "approved" ||
    input.approvalSummary?.approvalStatus === "not_required"
  ) {
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

export function buildPilotageExceptions(input: {
  projectId: string;
  intakeWorkspace: AffairePilotageWorkspace;
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
