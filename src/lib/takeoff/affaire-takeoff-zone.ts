import type { AffaireDossierState } from "@/lib/affaires/intake";
import { formatTakeoffCompletionDate, TAKEOFF_COMPLETION_LABELS, type TakeoffAnalysisOutcome } from "@/lib/takeoff/completion-outcome";
import {
  describeTakeoffLaunchReason,
  TAKEOFF_LAUNCH_TRANSIENT_REASONS,
  type TakeoffLaunchPiece,
  type TakeoffLaunchReason,
  type TakeoffLaunchRequestState,
} from "@/lib/takeoff/launch-request";
import { describeTakeoffLaunchAction, type TakeoffLaunchAction } from "@/lib/takeoff/operator-state";
import { isTakeoffVisibleJobInFlight, type TakeoffVisibleJobStatus } from "@/lib/takeoff/visible-status";

/**
 * The takeoff's zone on the affaire's page: the state of its latest launch request (or, without one, of its latest
 * analysis and of its dossier), the gesture it allows the member who reads it, its reviews and the access to its options.
 * The data is what the server projected for that member (affaire-takeoff-zone-server.ts); this module only words it.
 */

/** An analysis (a job): one grouped job per request in lot 2, one per plan in lot 3. */
export type AffaireTakeoffZoneJob = {
  id: string;
  /** The file it reads, as the activity names it. */
  name: string | null;
  status: TakeoffVisibleJobStatus;
  statusLabel: string;
  /** What happened when it stopped, in French. */
  failure: string | null;
  /** Its review, as soon as its result can be read. */
  reviewHref: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type AffaireTakeoffZoneRequest = {
  id: string;
  origin: "automatic" | "manual";
  state: TakeoffLaunchRequestState;
  /** A gesture names it, and is refused when it moved. */
  mandateRevision: number;
  reason: TakeoffLaunchReason | null;
  pieces: TakeoffLaunchPiece[];
  hasPayer: boolean;
  payerIsViewer: boolean;
  createdAt: string;
  admittedAt: string | null;
  closedAt: string | null;
  outcome: "success" | "failure" | "canceled" | "partial" | null;
  units: { expected: number | null; succeeded: number; failed: number; canceled: number };
  /** The gesture the database allows this member (public.takeoff_launch_request_action), with what their Mac allows. */
  action: TakeoffLaunchAction;
  /** Every analysis of the request, never only the latest by date. */
  jobs: AffaireTakeoffZoneJob[];
  /** What the request sealed: the plans it reads and the pieces it left out, by name. */
  coverage: null | {
    plansRetained: number;
    plansOmitted: Array<TakeoffLaunchPiece & { reason: "alternate" | "identical_copy" | "unsupported_format" }>;
    referencesOmitted: Array<TakeoffLaunchPiece & { reason: "unreadable" | "unsupported_format" | "limit" }>;
  };
  /** The event of its end: the members' notification and its e-mail. */
  completionEventId: string | null;
};

export type AffaireTakeoffZoneData = {
  /** Both cut-offs are set: the automatic start and the requests are on. */
  active: boolean;
  /** The member may prepare and launch a takeoff on this affaire (the preparation's write rule, read by the server). */
  canOperate: boolean;
  /** Active, and a dossier confirmed before it with no request. */
  confirmedBeforeActivation: boolean;
  /** The affaire's latest execution, never hidden by an automatic start set aside for it. */
  request: AffaireTakeoffZoneRequest | null;
  dossierChangedSinceAnalysis: null | { added: TakeoffLaunchPiece[]; replaced: TakeoffLaunchPiece[]; removed: TakeoffLaunchPiece[] };
  /** The affaire's latest analysis, whatever its request and its version. */
  latestJob: AffaireTakeoffZoneJob | null;
  /** The affaire's latest analysis whose result can be reviewed: a later failure never hides it. */
  latestReview: AffaireTakeoffZoneJob | null;
  /** The affaire's latest end of analysis, as its readers' activity and the members' notifications show it. */
  latestEnd: null | { eventId: string; outcome: TakeoffAnalysisOutcome; finishedAt: string; reason: string | null };
};

export type AffaireTakeoffZoneInput = {
  projectId: string;
  /** Null when the takeoff could not be read. */
  data: AffaireTakeoffZoneData | null;
  /** The dossier as its title reads it; null when the affaire's dossier is unknown. */
  dossier: AffaireDossierState | null;
  /** Plans in the affaire's plan sets. */
  planFileCount: number;
  /** The page lets the member act (not a director's review). Combined with the server's own rule; every gesture is checked again. */
  canOperate: boolean;
};

export type AffaireTakeoffZoneTone = "neutral" | "info" | "progress" | "success" | "warning" | "danger";

export type AffaireTakeoffZoneLink =
  | { key: string; kind: "href"; label: string; href: string }
  | { key: string; kind: "brief" | "documents" | "add_documents"; label: string };

/**
 * What the options of the takeoff launch:
 * - `version`: while the automatic start is off, the launch on a draft or a new draft, as before it;
 * - `request`: once it is on, a manual request (a first analysis, or a relaunch naming the analysis it replaces), never
 *   a job without a request, and no version: the send chooses it;
 * - `save_only`: the options are saved for the analysis that waits or runs; nothing is launched from them.
 */
export type AffaireTakeoffZoneOptions =
  | { mode: "version" }
  | { mode: "request"; predecessorJobId: string | null }
  | { mode: "save_only"; reason: string };

export type AffaireTakeoffZoneModel = {
  tone: AffaireTakeoffZoneTone;
  /** The state in a few words. */
  status: string;
  message: string | null;
  facts: string[];
  /** Pieces named by a blocking: what every reader of the affaire already sees in its dossier. */
  pieces: TakeoffLaunchPiece[];
  gesture: null | { kind: "take_on" | "resume"; label: string; requestId: string; revision: number };
  /** The gesture needs the connected Mac: this page runs elsewhere. */
  awayFromMac: boolean;
  reviews: Array<{ key: string; label: string; href: string }>;
  links: AffaireTakeoffZoneLink[];
  notice: null | { eventId: string; title: string; at: string; reason: string | null };
  dossierChange: AffaireTakeoffZoneData["dossierChangedSinceAnalysis"];
  options: AffaireTakeoffZoneOptions | null;
  /** Something may change without a gesture of this member: read the state again while it is shown. */
  live: boolean;
};

const ACTIVITY_LABEL = "Ouvrir le métré";
const PROFILE_REASONS = new Set<TakeoffLaunchReason>([
  "CHATGPT_NOT_CONNECTED", "CHATGPT_ACCESS_REVOKED", "CHATGPT_MODEL_MISSING", "CHATGPT_SELECTION_CHANGED",
]);
const TRANSIENT_REASONS = new Set<string>(TAKEOFF_LAUNCH_TRANSIENT_REASONS);
const DOSSIER_WAIT: Partial<Record<AffaireDossierState, TakeoffLaunchReason>> = {
  processing: "DOSSIER_PROCESSING", to_review: "DOSSIER_TO_REVIEW", brief_to_confirm: "BRIEF_NOT_CONFIRMED",
};

function plural(count: number, one: string, many: string) {
  return `${count} ${count > 1 ? many : one}`;
}

function reasonLinks(reason: TakeoffLaunchReason | null, canOperate: boolean): AffaireTakeoffZoneLink[] {
  switch (reason) {
    case "BRIEF_NOT_CONFIRMED": return [{ key: "brief", kind: "brief", label: "Revoir le brief" }];
    case "DOSSIER_EMPTY":
    case "NO_EXPLOITABLE_PLAN": return canOperate ? [{ key: "add", kind: "add_documents", label: "Ajouter des pièces" }] : [];
    case "DOSSIER_PROCESSING":
    case "DOSSIER_TO_REVIEW":
    case "PLAN_COPY_MISSING": return [{ key: "documents", kind: "documents", label: "Voir le dossier" }];
    default:
      return reason && PROFILE_REASONS.has(reason) && canOperate
        ? [{ key: "profile", kind: "href", label: "Mon profil", href: "/dashboard/profile" }] : [];
  }
}

function jobMessage(job: AffaireTakeoffZoneJob) {
  if (job.status === "action_required") return job.failure ? `L’analyse s’est arrêtée : ${job.failure}` : "L’analyse s’est arrêtée.";
  if (job.status === "review_required") return "Analyse terminée : des écarts sont à revoir avant l’envoi au devis.";
  if (job.status === "completed") return "Analyse terminée : vérifiez les quantités proposées avant de les envoyer au devis.";
  return job.status === "queued" ? "Analyse enregistrée : elle démarre dès que le Mac connecté la prend en charge."
    : "Analyse détaillée en cours sur le Mac connecté.";
}

function jobState(job: AffaireTakeoffZoneJob): Pick<AffaireTakeoffZoneModel, "tone" | "status"> {
  if (job.status === "queued") return { tone: "progress", status: "En attente du Mac" };
  if (isTakeoffVisibleJobInFlight(job.status)) return { tone: "progress", status: "En cours" };
  if (job.status === "action_required") return { tone: "danger", status: "Échoué" };
  return job.status === "review_required" ? { tone: "warning", status: "Revue requise" } : { tone: "success", status: "Terminé" };
}

type RequestState = Pick<AffaireTakeoffZoneModel, "tone" | "status" | "message" | "facts">;

function describeRequest(request: AffaireTakeoffZoneRequest): RequestState {
  const facts: string[] = [];
  const reasonText = request.reason ? describeTakeoffLaunchReason(request.reason, request.pieces) : null;
  switch (request.state) {
    case "evaluating":
      facts.push(`Demande enregistrée le ${formatTakeoffCompletionDate(request.createdAt)}`);
      return { tone: "progress", status: "En préparation", facts, message: request.hasPayer
        ? "Dossier confirmé : le Mac connecté vérifie les plans avant de lancer l’analyse détaillée."
        : "Dossier confirmé : le métré attend sa prise en charge." };
    case "not_eligible":
      return { tone: "info", status: request.reason === "NO_EXPLOITABLE_PLAN" ? "Aucun plan exploitable" : "En attente du dossier",
        message: reasonText, facts };
    case "blocked":
      return request.reason && TRANSIENT_REASONS.has(request.reason)
        ? { tone: "progress", status: "En attente", message: reasonText, facts }
        : { tone: "warning", status: "Non démarré", message: reasonText, facts };
    case "superseded":
      return { tone: "neutral", status: "Remplacé", message: describeTakeoffLaunchReason("SUPERSEDED"), facts };
    case "admitted": {
      if (request.admittedAt) facts.push(`Démarrée le ${formatTakeoffCompletionDate(request.admittedAt)}`);
      if ((request.units.expected ?? 0) > 1) {
        facts.push(`${plural(request.units.succeeded, "plan lu", "plans lus")} sur ${request.units.expected}`);
      }
      const running = request.jobs.find((entry) => isTakeoffVisibleJobInFlight(entry.status));
      const queued = running?.status === "queued" && !request.jobs.some((entry) => entry.status === "processing");
      return queued
        ? { tone: "progress", status: "En attente du Mac", message: jobMessage(running!), facts }
        : { tone: "progress", status: "En cours", message: "Analyse détaillée en cours sur le Mac connecté.", facts };
    }
    case "closed": {
      if (request.closedAt) facts.push(`Terminée le ${formatTakeoffCompletionDate(request.closedAt)}`);
      if (request.reason === "BUDGET_EXHAUSTED") return { tone: "danger", status: "Échoué", message: reasonText, facts };
      if (request.outcome === "success") {
        return { tone: "success", status: "Terminé", message: request.jobs.some((entry) => entry.status === "review_required")
          ? "Analyse terminée : des écarts sont à revoir avant l’envoi au devis."
          : "Analyse terminée : vérifiez les quantités proposées avant de les envoyer au devis.", facts };
      }
      if (request.outcome === "partial") {
        return { tone: "warning", status: "Partiel", facts, message:
          `Analyse terminée pour ${plural(request.units.succeeded, "plan", "plans")} sur ${request.units.expected ?? request.jobs.length}.` };
      }
      if (request.outcome === "canceled") return { tone: "neutral", status: "Annulé", message: "Analyse annulée.", facts };
      const failed = request.jobs.find((entry) => entry.status === "action_required");
      return { tone: "danger", status: "Échoué", message: failed ? jobMessage(failed) : "L’analyse s’est arrêtée.", facts };
    }
  }
}

/** Requests that can still start (the automatic one, waiting for its dossier, its Mac or a gesture). */
function isOpen(request: AffaireTakeoffZoneRequest | null) {
  return request !== null && (request.state === "evaluating" || request.state === "not_eligible" || request.state === "blocked");
}

function decideOptions(input: AffaireTakeoffZoneInput, data: AffaireTakeoffZoneData): AffaireTakeoffZoneOptions | null {
  if (!input.canOperate || input.planFileCount === 0) return null;
  if (!data.active) return { mode: "version" };
  const { request } = data;
  if (request?.state === "admitted") {
    return { mode: "save_only", reason: "Une analyse de l’affaire est en cours : vos options s’appliqueront à la prochaine analyse." };
  }
  if (isOpen(request)) {
    return { mode: "save_only", reason: "Le métré de l’affaire n’a pas encore démarré : il reprendra vos options à son démarrage." };
  }
  // No request yet and a dossier still on its way to « confirmé »: its confirmation starts the analysis.
  const dossierWait = input.dossier ? DOSSIER_WAIT[input.dossier] : undefined;
  if (!request && !data.latestJob && dossierWait && !data.confirmedBeforeActivation) {
    return { mode: "save_only", reason: "Le métré démarrera quand le dossier sera confirmé : il reprendra vos options." };
  }
  return { mode: "request", predecessorJobId: request?.jobs[0]?.id ?? data.latestJob?.id ?? null };
}

export function buildAffaireTakeoffZone(zoneInput: AffaireTakeoffZoneInput): AffaireTakeoffZoneModel | null {
  const { data, projectId } = zoneInput;
  const input = { ...zoneInput, canOperate: zoneInput.canOperate && (data?.canOperate ?? false) };
  const activityHref = `/dashboard/affaires/${projectId}/takeoff`;
  if (!data) {
    return { tone: "neutral", status: "Indisponible", message: "L’état du métré n’a pas pu être lu. Réessayez dans un instant.",
      facts: [], pieces: [], gesture: null, awayFromMac: false, reviews: [], links: [], notice: null, dossierChange: null,
      options: null, live: false };
  }
  const { request, latestJob } = data;
  const hasDossier = input.dossier !== null && input.dossier !== "empty";
  if (!request && !latestJob && input.planFileCount === 0 && !hasDossier) return null;

  let state: RequestState;
  let pieces: TakeoffLaunchPiece[] = [];
  const links: AffaireTakeoffZoneLink[] = [];
  if (request) {
    state = describeRequest(request);
    pieces = request.pieces;
    links.push(...reasonLinks(request.state === "superseded" ? null : request.reason, input.canOperate));
  } else if (latestJob) {
    state = { ...jobState(latestJob), message: jobMessage(latestJob), facts: [] };
  } else if (data.active && data.confirmedBeforeActivation) {
    state = { tone: "warning", status: "Non démarré", facts: [], message: input.canOperate
      ? "Dossier confirmé avant l’activation — options disponibles"
      : "Dossier confirmé avant l’activation du démarrage automatique : aucune analyse n’a démarré." };
  } else if (data.active && input.dossier && DOSSIER_WAIT[input.dossier]) {
    const reason = DOSSIER_WAIT[input.dossier]!;
    state = { tone: "info", status: "En attente du dossier", message: describeTakeoffLaunchReason(reason), facts: [] };
    links.push(...reasonLinks(reason, input.canOperate));
  } else if (input.planFileCount === 0) {
    state = { tone: "neutral", status: "Aucun plan", message: "Aucun plan à analyser pour le moment.", facts: [] };
    if (input.canOperate) links.push({ key: "plans", kind: "href", label: "Ajouter des plans", href: `/dashboard/affaires/${projectId}/plans` });
  } else {
    state = { tone: "neutral", status: "Non démarré", facts: [], message: input.canOperate
      ? "Aucune analyse des plans pour le moment. Lancez-la depuis les options du métré."
      : "Aucune analyse des plans pour le moment." };
  }

  // Every analysis of the request whose result can be read, then the affaire's latest one when none of them can.
  const requestJobs = request?.jobs ?? (latestJob ? [latestJob] : []);
  const readable = requestJobs.filter((entry) => entry.reviewHref);
  const reviews = readable.map((entry) => ({ key: entry.id, href: entry.reviewHref!,
    label: requestJobs.length > 1 && entry.name ? `Revoir ${entry.name}` : "Revoir l’analyse" }));
  if (reviews.length === 0 && data.latestReview?.reviewHref && !requestJobs.some((entry) => entry.id === data.latestReview!.id)) {
    reviews.push({ key: data.latestReview.id, href: data.latestReview.reviewHref,
      label: requestJobs.length > 0 ? "Revoir l’analyse précédente" : "Revoir l’analyse" });
  }
  if (request || latestJob) links.push({ key: "activity", kind: "href", label: ACTIVITY_LABEL, href: activityHref });

  const action = data.active && input.canOperate && request ? request.action : "none";
  const gesture = action === "take_on" || action === "resume"
    ? { kind: action, label: describeTakeoffLaunchAction(action)!, requestId: request!.id, revision: request!.mandateRevision }
    : null;
  const { latestEnd } = data;
  const live = request ? request.state === "evaluating" || request.state === "admitted"
    || (request.state === "blocked" && TRANSIENT_REASONS.has(request.reason ?? ""))
    : latestJob ? isTakeoffVisibleJobInFlight(latestJob.status) : false;

  return {
    ...state,
    pieces,
    gesture,
    awayFromMac: action === "open_mac",
    reviews,
    links,
    notice: latestEnd ? { eventId: latestEnd.eventId, title: TAKEOFF_COMPLETION_LABELS[latestEnd.outcome],
      at: formatTakeoffCompletionDate(latestEnd.finishedAt), reason: latestEnd.reason } : null,
    dossierChange: data.dossierChangedSinceAnalysis,
    options: decideOptions(input, data),
    live,
  };
}
