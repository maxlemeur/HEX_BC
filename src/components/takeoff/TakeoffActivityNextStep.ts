import type { TakeoffActivityCenterJobRow } from "@/lib/takeoff/types";
import { TAKEOFF_RESUME_RELOAD_TEXT } from "@/components/takeoff/takeoff-resume-view";
import { describeTakeoffResume } from "@/lib/takeoff/operator-state";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";
import { describeTakeoffJobFailure } from "@/lib/takeoff/visible-status";

export type TakeoffNextStepAction =
  | { kind: "launch"; label: string }
  | { kind: "href"; label: string; href: string };

/** The one thing the métreur should do now on the affaire's métrés page. */
export type TakeoffNextStep = {
  title: string;
  description: string;
  action: TakeoffNextStepAction | null;
};

/** What the server resolved for the affaire's latest analysis, as the hub does. */
export type TakeoffLatestJobContext = {
  jobId: string;
  /** The version the review opens on: the current one when the job was carried over to it. */
  reviewVersionId: string;
  failureReasonLabel: string | null;
};

// Visible statuses of an analysis still running (see resolveTakeoffVisibleJobStatus).
const RUNNING = new Set(["queued", "processing", "provider_pending"]);

/**
 * Like the hub, the step follows the affaire's latest analysis, whatever the list filters:
 * an older analysis it replaced no longer asks for a review.
 */
export function resolveTakeoffNextStep({
  projectId,
  latestJob,
  latestJobContext,
  canLaunch,
  firstUsablePlanSetName,
  planSetCount,
}: {
  projectId: string;
  latestJob: TakeoffActivityCenterJobRow | null;
  latestJobContext: TakeoffLatestJobContext | null;
  /** The preparation dialog is available on this page. */
  canLaunch: boolean;
  firstUsablePlanSetName: string | null;
  planSetCount: number;
}): TakeoffNextStep {
  const plansHref = `/dashboard/affaires/${projectId}/plans`;
  const launchAgain: TakeoffNextStepAction | null = canLaunch
    ? { kind: "launch", label: "Préparer un nouveau métré" }
    : null;

  if (!latestJob) {
    if (firstUsablePlanSetName) {
      return {
        title: "Préparer le premier métré",
        description: `Le jeu « ${firstUsablePlanSetName} » contient des plans. Confirmez le périmètre et les conventions : l’IA analyse ensuite les plans et propose les quantités.`,
        action: canLaunch ? { kind: "launch", label: "Préparer le métré" } : null,
      };
    }
    if (planSetCount > 0) {
      return {
        title: "Ajouter des PDF aux plans",
        description: "Les jeux de plans existent, mais ils ne contiennent encore aucun fichier à analyser.",
        action: { kind: "href", label: "Ajouter des plans", href: plansHref },
      };
    }
    return {
      title: "Ajouter les plans de l’affaire",
      description: "Créez un jeu de plans, ajoutez vos fichiers PDF, puis préparez le premier métré.",
      action: { kind: "href", label: "Ajouter un jeu de plans", href: plansHref },
    };
  }

  const context = latestJobContext?.jobId === latestJob.jobId ? latestJobContext : null;

  if (RUNNING.has(latestJob.statusRaw)) {
    return {
      title: "Analyse en cours",
      description: "L’IA lit vos plans. Cette page se met à jour toute seule : vous pouvez la quitter et revenir plus tard.",
      action: null,
    };
  }

  if (latestJob.neverApplied) {
    const source = latestJob.planSetLabel ? `« ${latestJob.planSetLabel} »` : "ces plans";
    const versionId = context?.reviewVersionId ?? latestJob.estimateVersionId;
    return {
      title: "Vérifier le métré proposé",
      description: `L’IA a proposé ${latestJob.itemCount} élément${latestJob.itemCount > 1 ? "s" : ""} pour ${source}. Contrôlez-les avant de les reporter au devis.`,
      action: {
        kind: "href",
        label: "Ouvrir la revue",
        href: takeoffReviewHref({ projectId, jobId: latestJob.jobId, versionId }),
      },
    };
  }

  if (latestJob.technicalStatusRaw === "applied") {
    return {
      title: "Métré reporté au devis",
      description: "Les quantités de la dernière analyse sont dans le devis. Préparez un nouveau métré quand de nouveaux plans arrivent.",
      action: launchAgain,
    };
  }

  // A stopped analysis: the banner says what its resume decision says, and offers a new analysis only when the decision
  // does (a member who cannot act, a retry to wait for or a retry of the same analysis get no launch button).
  const canceled = latestJob.technicalStatusRaw === "canceled";
  if (canceled || latestJob.statusRaw === "action_required") {
    const lead = canceled
      ? "La dernière analyse a été arrêtée avant la fin."
      : `La dernière analyse n’a pas abouti. ${describeTakeoffJobFailure(latestJob.errorCode)}`;
    const decision = latestJob.resume;
    const next = decision ? describeTakeoffResume(decision) : TAKEOFF_RESUME_RELOAD_TEXT;
    return {
      title: canceled ? "Analyse annulée" : decision?.reason === "retry_scheduled" ? "Reprise programmée" : "Analyse à reprendre",
      description: next ? `${lead} ${next}` : lead,
      action: decision?.action === "new_analysis" ? launchAgain : null,
    };
  }

  return {
    title: "Rien à traiter pour l’instant",
    description: "Aucune analyse n’attend votre revue. Préparez un nouveau métré quand de nouveaux plans arrivent.",
    action: launchAgain,
  };
}
