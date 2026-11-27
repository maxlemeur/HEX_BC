import {
  isAffaireIntakeDocumentNeedingReview,
} from "@/lib/affaires/intake";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-workspace-server";
import {
  AFFAIRE_REGISTER_REVALIDATION_IMPACTED_STAGE_LABELS,
  buildAffaireRegisterHubHref,
  type AffaireRegisterSummary,
} from "@/lib/affaires/register";
import type {
  AffaireHubDpgfSourceResult,
  AffaireHubFinishLineSummaryResult,
} from "@/lib/affaires/server";
import type { EstimateApprovalSummary } from "@/lib/estimates/approval-types";
import {
  ESTIMATE_READINESS_CATEGORY_LABELS,
} from "@/lib/estimates/readiness";
import type { EstimateStructureModeSummary } from "@/lib/estimates/structure-mode";
import type { CockpitSurfaceId } from "@/lib/cockpit/suggestions";
import { takeoffDpgfExceptionsHref } from "@/lib/takeoff/review-href";
import { type AffaireHubPlansSummaryData } from "@/lib/affaires/hub-plans-summary";

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
      status: import("@/lib/estimates/status").EstimateStatus;
      versionNumber: number;
      updatedAt?: string;
    }
  | null;

export type AffairePilotageStructureMode =
  | (Pick<
      EstimateStructureModeSummary,
      | "mode"
      | "lineCount"
      | "importedLineCount"
      | "manualLineCount"
      | "canImportLinkedDpgfIntoCurrentStructure"
      | "linkedDpgfMappedRowCount"
    > & {
      unsupportedLineCount?: number;
    })
  | null;

type ReadyToSendBlockingFlag =
  NonNullable<AffaireHubFinishLineSummaryResult>["readyToSend"]["blockingFlags"][number];

type SubmissionReadinessSnapshot =
  NonNullable<AffaireHubFinishLineSummaryResult["submissionReadiness"]>;

type SubmissionReadinessGroup =
  SubmissionReadinessSnapshot["groups"][number];

export function resolveSubmissionReadiness(
  finishLineSummary: AffaireHubFinishLineSummaryResult | null | undefined
): SubmissionReadinessSnapshot | null {
  if (!finishLineSummary) {
    return null;
  }

  if (finishLineSummary.submissionReadiness) {
    return finishLineSummary.submissionReadiness;
  }

  const readyToSend = finishLineSummary.readyToSend;

  return {
    status: readyToSend.status === "waiting" ? "unavailable" : readyToSend.status,
    blockers: readyToSend.blockingFlags,
    alerts: readyToSend.warningFlags,
    groups: [],
    checkedAt: readyToSend.checkedAt,
    stalePriceDays: readyToSend.stalePriceDays,
    errorMessage: readyToSend.errorMessage,
  };
}

export function isPdfFinishLineFlag(flag: ReadyToSendBlockingFlag) {
  return flag.category === "pdf" || flag.key === "no_pdf_generated";
}

function formatSubmissionReadinessGroupCount(input: {
  blockerCount: number;
  alertCount: number;
}) {
  const parts: string[] = [];

  if (input.blockerCount > 0) {
    parts.push(
      `${input.blockerCount} blocage${input.blockerCount > 1 ? "s" : ""}`,
    );
  }

  if (input.alertCount > 0) {
    parts.push(
      `${input.alertCount} reserve${input.alertCount > 1 ? "s" : ""}`,
    );
  }

  return parts.join(", ");
}

export function describeSubmissionReadinessGroup(
  group: SubmissionReadinessGroup,
) {
  const categoryLabel = ESTIMATE_READINESS_CATEGORY_LABELS[group.category];
  const countLabel = formatSubmissionReadinessGroupCount({
    blockerCount: group.blockerCount,
    alertCount: group.alertCount,
  });

  return `${categoryLabel} · ${countLabel}`;
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

export function buildTakeoffExceptionsHref(
  projectId: string,
  plansSummary: AffaireHubPlansSummaryData
) {
  const latestJob = plansSummary.latestJob;
  if (!latestJob) {
    return `/dashboard/affaires/${projectId}/takeoff`;
  }

  return takeoffDpgfExceptionsHref({ projectId, jobId: latestJob.jobId, versionId: latestJob.reviewVersionId });
}

function countDocumentsNeedingReview(intakeWorkspace: AffairePilotageWorkspace) {
  if (!intakeWorkspace) {
    return 0;
  }

  return intakeWorkspace.documents.filter(isAffaireIntakeDocumentNeedingReview).length;
}

export function buildPilotageSteps(input: {
  intakeWorkspace: AffairePilotageWorkspace;
  dpgfSource: AffaireHubDpgfSourceResult;
  plansSummary: AffaireHubPlansSummaryData | null;
  approvalSummary: EstimateApprovalSummary | null;
  currentVersion: AffairePilotageCurrentVersion;
  lineCount: number;
  structureMode?: AffairePilotageStructureMode;
  takeoffEnabled: boolean;
}) {
  const latestJob = input.plansSummary?.latestJob ?? null;
  const takeoffCoverageAvailable =
    input.plansSummary?.coveragePercent != null &&
    input.plansSummary?.exceptionCount != null;

  let metreStep: PilotageStep;
  if (!input.takeoffEnabled) {
    metreStep = {
      key: "metre",
      label: "Métré & preuves",
      status: "waiting",
      summary: "Le métré assiste n'est pas activé pour cette affaire.",
    };
  } else if ((input.plansSummary?.planSetCount ?? 0) === 0) {
    metreStep = {
      key: "metre",
      label: "Métré & preuves",
      status: "waiting",
      summary: "Ajoutez des plans pour lancer l'analyse et comparer les quantités.",
    };
  } else if (latestJob?.status === "action_required") {
    metreStep = {
      key: "metre",
      label: "Métré & preuves",
      status: "blocked",
      summary:
        input.plansSummary?.failureReasonLabel ??
        "La dernière analyse des plans n’a pas abouti.",
    };
  } else if (latestJob?.status === "review_required") {
    const exceptionCount = input.plansSummary?.exceptionCount;
    metreStep = {
      key: "metre",
      label: "Métré & preuves",
      status: "blocked",
      summary:
        typeof exceptionCount === "number" && exceptionCount > 0
          ? `${exceptionCount} écart${exceptionCount > 1 ? "s" : ""} majeur${exceptionCount > 1 ? "s" : ""} à revoir.`
          : takeoffCoverageAvailable
            ? "La revue des métrés reste requise avant d'appliquer les quantités dans le devis."
            : "La revue des métrés reste requise, mais le résumé comparé est indisponible.",
    };
  } else if (
    latestJob &&
    (latestJob.status === "queued" ||
      latestJob.status === "processing" ||
      latestJob.status === "provider_pending")
  ) {
    metreStep = {
      key: "metre",
      label: "Métré & preuves",
      status: "in_progress",
      summary: `${latestJob.label}.`,
    };
  } else if ((input.plansSummary?.exceptionCount ?? 0) > 0) {
    metreStep = {
      key: "metre",
      label: "Métré & preuves",
      status: "blocked",
      summary: `${input.plansSummary?.exceptionCount ?? 0} écart${(input.plansSummary?.exceptionCount ?? 0) > 1 ? "s" : ""} majeur${(input.plansSummary?.exceptionCount ?? 0) > 1 ? "s" : ""} à revoir.`,
    };
  } else if (latestJob && latestJob.status === "completed") {
    const coveragePercent = input.plansSummary?.coveragePercent;
    metreStep = {
      key: "metre",
      label: "Métré & preuves",
      status: "done",
      summary:
        typeof coveragePercent === "number"
          ? `${coveragePercent} % des postes sont couverts par l'analyse.`
          : "Analyse des plans disponible dans l'affaire.",
    };
  } else {
    metreStep = {
      key: "metre",
      label: "Métré & preuves",
      status: "in_progress",
      summary: "Les plans sont synchronisés et l'analyse peut être relancée.",
    };
  }

  return [metreStep] satisfies PilotageStep[];
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
      title: `Confirmer ${reviewDocumentsCount} pièce${reviewDocumentsCount > 1 ? "s" : ""} ambigu${reviewDocumentsCount > 1 ? "es" : "e"}`,
      summary:
        "Classez les documents à revoir pour éviter de propager une mauvaise interpretation du dossier.",
      severity: "warning",
      action: {
        kind: "href",
        label: "Ouvrir les pièces à revoir",
        href: `/dashboard/affaires/${input.projectId}?intakeFilter=a_revoir#intake`,
      },
    });
  }

  if (missingPiecesCount > 0 && allowSurfaceActions) {
    exceptions.push({
      id: "missing-pieces",
      title: `Ajouter ${missingPiecesCount} pièce${missingPiecesCount > 1 ? "s" : ""} manquante${missingPiecesCount > 1 ? "s" : ""}`,
      summary:
        criticalMissingPiecesCount > 0
          ? "Le dossier reste incomplet sur des pièces critiques."
          : "Le dossier peut avancer, mais certaines pièces restent utiles pour fiabiliser la suite.",
      severity: criticalMissingPiecesCount > 0 ? "critical" : "info",
      action: {
        kind: "surface",
        label: "Ajouter des pièces",
        surfaceId: "intake-upload",
      },
    });
  }

  if (input.intakeWorkspace?.briefDraft?.status === "a_confirmer" && allowSurfaceActions) {
    exceptions.push({
      id: "brief-confirm",
      title: "Confirmer le brief affaire",
      summary:
        "Validez ou corrigez hypothèses, points de vigilance et manques avant les automations aval.",
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
        "Le dernier import du DPGF a échoué. Reprenez cette étape avant de structurer le devis.",
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
        "Le DPGF est importé mais son mapping doit être validé avant de poursuivre le chiffrage.",
      severity: "warning",
      action: {
        kind: "href",
        label: "Vérifier le DPGF",
        href: "#dpgf",
      },
    });
  }

  if ((input.registerSummary?.criticalOpenCount ?? 0) > 0) {
    const count = input.registerSummary?.criticalOpenCount ?? 0;
    exceptions.push({
      id: "register-critical",
      title: `${count} point${count > 1 ? "s" : ""} critique${count > 1 ? "s" : ""} à arbitrer`,
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
          focusEntryId: input.registerSummary?.openQuestionsFocusEntryId ?? null,
        })}#register`,
      },
    });
  } else if ((input.registerSummary?.revalidationRequiredCount ?? 0) > 0) {
    const count = input.registerSummary?.revalidationRequiredCount ?? 0;
    const criticalCount = input.registerSummary?.criticalRevalidationRequiredCount ?? 0;
    const revalidationStages = (input.registerSummary?.revalidationImpactedStages ?? [])
      .slice(0, 2)
      .map((stage) => AFFAIRE_REGISTER_REVALIDATION_IMPACTED_STAGE_LABELS[stage])
      .join(" + ");
    exceptions.push({
      id: "register-revalidation",
      title: `${count} revalidation${count > 1 ? "s" : ""} à relancer`,
      summary: revalidationStages
        ? `Le dossier a change. Reprenez ${revalidationStages.toLowerCase()} avant la suite.`
        : "Le dossier a change. Reprenez la revalidation ciblee avant la suite.",
      severity: criticalCount > 0 ? "critical" : "warning",
      action: {
        kind: "href",
        label: "Voir les revalidations",
        href: `${buildAffaireRegisterHubHref({
          projectId: input.projectId,
          severity: criticalCount > 0 ? "critical" : null,
          revalidationRequired: true,
          focusEntryId: input.registerSummary?.revalidationFocusEntryId ?? null,
        })}#register`,
      },
    });
  } else if ((input.registerSummary?.clarifyWithClientCount ?? 0) > 0) {
    const count = input.registerSummary?.clarifyWithClientCount ?? 0;
    const criticalCount = input.registerSummary?.criticalClarifyWithClientCount ?? 0;
    exceptions.push({
      id: "register-clarify",
      title: `${count} clarification${count > 1 ? "s" : ""} client à porter`,
      summary:
        criticalCount > 0
          ? "Un retour client reste attendu sur un point critique du dossier."
          : "Le dossier reste actif, mais un retour client reste attendu pour la suite.",
      severity: criticalCount > 0 ? "critical" : "warning",
      action: {
        kind: "href",
        label: "Voir les clarifications client",
        href: `${buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: "clarify_with_client",
          focusEntryId: input.registerSummary?.clarifyWithClientFocusEntryId ?? null,
        })}#register`,
      },
    });
  } else if ((input.registerSummary?.openQuestionsCount ?? 0) > 0) {
    const count = input.registerSummary?.openQuestionsCount ?? 0;
    exceptions.push({
      id: "register-open",
      title: `${count} point${count > 1 ? "s" : ""} registre en attente`,
      summary:
        "Le registre concentre les hypothèses et clarifications encore ouvertes dans l'affaire.",
      severity: "warning",
      action: {
        kind: "href",
        label: "Voir le registre",
        href: `${buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: "open",
          severity: null,
          focusEntryId: input.registerSummary?.openQuestionsFocusEntryId ?? null,
        })}#register`,
      },
    });
  }

  if (input.plansSummary?.latestJob?.status === "action_required") {
    exceptions.push({
      id: "takeoff-action-required",
      // The overview does not know the member's resume decision: the activity it links to says what to do.
      title: "Analyse des plans arrêtée",
      summary:
        input.plansSummary.failureReasonLabel ??
        "La dernière analyse des plans n’a pas abouti.",
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
      title: `${count} écart${count > 1 ? "s" : ""} majeur${count > 1 ? "s" : ""} sur les métrés`,
      summary:
        "Revoyez les preuves et les écarts avant d'appliquer les quantités dans le devis.",
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
        "Le backend signale qu'une revue reste requise avant d'exploiter les métrés dans le devis.",
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
      title: "Analyse des plans",
      summary:
        "Les plans sont présents dans l'affaire : l'état du métré dit où en est leur analyse.",
      severity: "info",
      action: {
        kind: "surface",
        label: "Voir l'état du métré",
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
