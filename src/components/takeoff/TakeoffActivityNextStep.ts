import type { TakeoffActivityCenterJobRow } from "@/lib/takeoff/types";
import { TAKEOFF_RESUME_RELOAD_TEXT } from "@/components/takeoff/takeoff-resume-view";
import { describeTakeoffResume, viewerLaunchAction } from "@/lib/takeoff/operator-state";
import { describeTakeoffRequestActivityCoverage, reviewableTakeoffRequestUnits } from "@/lib/takeoff/request-activity";
import type { TakeoffRequestActivity } from "@/lib/takeoff/request-activity-contracts";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";
import { describeTakeoffJobFailure, isTakeoffKeyStopMessage } from "@/lib/takeoff/visible-status";

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
    // The server read the job's stored message: a stop of a request paid by a key is told as its worker recorded it.
    const stored = context?.failureReasonLabel;
    const lead = canceled
      ? "La dernière analyse a été arrêtée avant la fin."
      : `La dernière analyse n’a pas abouti. ${isTakeoffKeyStopMessage(stored) ? stored : describeTakeoffJobFailure(latestJob.errorCode)}`;
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

/**
 * The step when the affaire's latest execution is a launch request: it follows the request and its plans, never the latest
 * job by date (a failure or a wait of one plan never hides the review of another). « Revoir [plan] » from the first plan
 * read, while the others are still read. Null when there is no request to follow (or only one set aside).
 */
export function resolveTakeoffRequestStep({
  projectId,
  request,
  canLaunch,
}: {
  projectId: string;
  request: TakeoffRequestActivity | null;
  canLaunch: boolean;
}): TakeoffNextStep | null {
  if (!request || request.state === "superseded") return null;
  const launchAgain: TakeoffNextStepAction | null = canLaunch ? { kind: "launch", label: "Préparer un nouveau métré" } : null;
  const coverage = describeTakeoffRequestActivityCoverage(request);
  const lead = coverage ? `${coverage}. ` : "";
  const jobs = new Map(request.jobs.map((job) => [job.jobId, job]));
  const readable = reviewableTakeoffRequestUnits(request);
  const first = readable.find((unit) => !jobs.get(unit.jobId)?.applied);
  const grouped = request.units?.format === "grouped";
  const review: TakeoffNextStepAction | null = first ? {
    kind: "href",
    label: grouped ? "Ouvrir la revue" : `Revoir ${first.name}`,
    href: takeoffReviewHref({ projectId, jobId: first.jobId, versionId: jobs.get(first.jobId)?.estimateVersionId ?? null }),
  } : null;

  switch (request.state) {
    case "evaluating":
      return {
        title: "Métré en préparation",
        description: "Le Mac autorisé vérifie le dossier avant de lire les plans. Cette page se met à jour toute seule.",
        action: null,
      };
    case "not_eligible":
    case "blocked":
      return {
        title: viewerLaunchAction(null, false, request.state, request.reason?.code ?? null) === "wait" ? "Métré en attente" : "Métré non démarré",
        description: request.reason?.message ?? "Le métré n’a pas encore démarré.",
        action: null,
      };
    case "admitted":
      if (grouped) {
        return review
          ? { title: "Vérifier le métré proposé", description: `${lead}Contrôlez-le avant de le reporter au devis.`, action: review }
          : { title: "Analyse en cours", description: "L’IA lit vos plans. Cette page se met à jour toute seule : vous pouvez la quitter et revenir plus tard.", action: null };
      }
      if (review) return { title: "Premiers plans prêts à revoir", description: `${lead}Les autres plans sont encore lus : cette page se met à jour toute seule.`, action: review };
      return { title: "Analyse en cours", description: `${lead}L’IA lit vos plans un par un. Cette page se met à jour toute seule : vous pouvez la quitter et revenir plus tard.`, action: null };
    case "closed": {
      if (review) return { title: "Vérifier le métré proposé", description: `${lead}Contrôlez chaque plan avant de le reporter au devis.`, action: review };
      if (readable.length > 0) {
        // Only what this member can establish: the plans they review are sent; the others are out of their reach.
        return readable.length === (request.units?.coverage.succeeded ?? 0)
          ? { title: "Métré reporté au devis", description: "Les plans lus sont dans le devis. Préparez un nouveau métré quand de nouveaux plans arrivent.", action: launchAgain }
          : { title: "Plans lus", description: `${lead}Les plans que vous pouvez revoir sont reportés au devis ; les autres ne sont pas accessibles avec votre profil.`, action: launchAgain };
      }
      // Read plans whose analyses this member does not read: said as such, never as plans that could not be read.
      if ((request.units?.coverage.succeeded ?? 0) > 0) {
        return { title: "Plans lus", description: `${lead}La revue n’est pas accessible avec votre profil.`, action: null };
      }
      // Nothing read: each plan says why, and a new analysis is offered only when a plan's decision offers it to this member.
      const offersNew = request.jobs.some((job) => job.resume?.action === "new_analysis");
      return {
        title: request.outcome === "canceled" ? "Analyse arrêtée" : "Aucun plan n’a pu être lu",
        description: `${lead}Le motif de chaque plan est indiqué ci-dessous.`,
        action: offersNew ? launchAgain : null,
      };
    }
  }
}
