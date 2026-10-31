import type { TakeoffActivityCenterJobRow } from "@/lib/takeoff/types";

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
        href: `/dashboard/affaires/${projectId}/takeoff/${latestJob.jobId}/review?versionId=${versionId}`,
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

  if (latestJob.technicalStatusRaw === "canceled") {
    return {
      title: "Analyse annulée",
      description: "La dernière analyse a été arrêtée avant la fin. Préparez un nouveau métré quand vous êtes prêt.",
      action: launchAgain,
    };
  }

  if (latestJob.statusRaw === "action_required") {
    // The failure labels already say what to do next.
    const hint = context?.failureReasonLabel ?? (latestJob.canResubmit
      ? "Relancez-la depuis la liste ci-dessous ou préparez un nouveau métré."
      : "Préparez un nouveau métré.");
    return {
      title: "Analyse à reprendre",
      description: `La dernière analyse n’a pas abouti. ${hint}`,
      action: launchAgain,
    };
  }

  return {
    title: "Rien à traiter pour l’instant",
    description: "Aucune analyse n’attend votre revue. Préparez un nouveau métré quand de nouveaux plans arrivent.",
    action: launchAgain,
  };
}
