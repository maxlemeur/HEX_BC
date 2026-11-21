import type {
  TakeoffJobStatus,
  TakeoffProcessingStrategy,
  TakeoffProviderBatchState,
} from "@/lib/takeoff/types";

export const TAKEOFF_VISIBLE_JOB_STATUSES = [
  "queued",
  "processing",
  "provider_pending",
  "review_required",
  "action_required",
  "completed",
] as const;

export const TAKEOFF_IN_FLIGHT_VISIBLE_JOB_STATUSES = [
  "queued",
  "processing",
  "provider_pending",
] as const;

export type TakeoffVisibleJobStatus =
  (typeof TAKEOFF_VISIBLE_JOB_STATUSES)[number];

type ResolveTakeoffVisibleJobStatusInput = {
  status: TakeoffJobStatus | string;
  processingStrategy?: TakeoffProcessingStrategy | null;
  providerBatchState?: TakeoffProviderBatchState | null;
  exceptionCount?: number | null;
  compareSummaryUnavailable?: boolean;
};

type TakeoffVisibleJobStatusDescriptor = {
  status: TakeoffVisibleJobStatus;
  label: string;
};

const TAKEOFF_VISIBLE_JOB_STATUS_LABELS: Record<
  TakeoffVisibleJobStatus,
  string
> = {
  queued: "En file",
  processing: "En traitement",
  provider_pending: "En attente du fournisseur IA",
  review_required: "Revue requise",
  action_required: "Échec à corriger",
  completed: "Analyse terminée",
};

const PROVIDER_PENDING_STATES = new Set<TakeoffProviderBatchState>([
  "submitted",
  "pending",
  "running",
]);

const IN_FLIGHT_VISIBLE_STATUS_SET = new Set<TakeoffVisibleJobStatus>(
  TAKEOFF_IN_FLIGHT_VISIBLE_JOB_STATUSES,
);

// What happened, wherever a stopped analysis is shown (the activity, the affaire's overview, the notifications): never
// what to do, which only the resume decision says where it is known. A new analysis stays detailed: no text proposes
// another level.
const FAILURE_FACTS: Record<string, string> = {
  AI_PROVIDER: "Le service d’analyse n’a pas pu terminer le métré.",
  AI_RATE_LIMIT: "Le service d’analyse a refusé temporairement la demande.",
  FORBIDDEN: "L’accès nécessaire au traitement n’est plus disponible.",
  INTERNAL_ERROR: "Une erreur interne a interrompu l’analyse.",
  TAKEOFF_WORKER_NOT_STARTED: "L’analyse n’a pas pu démarrer sur le poste autorisé.",
  TAKEOFF_WORKER_HOST_SILENT: "Le poste autorisé ne s’est pas manifesté avant la fin du délai d’attente maximal : l’analyse n’a pas démarré.",
  TAKEOFF_WORKER_QUEUE_EXPIRED: "L’analyse attendait encore son tour sur le poste autorisé quand le délai d’attente maximal a expiré : elle n’a pas démarré.",
  TAKEOFF_WORKER_OUTCOME_UNKNOWN: "Le traitement a été interrompu. Son résultat est inconnu.",
  TAKEOFF_FILE_TYPE_INVALID: "Document non exploitable.",
  TAKEOFF_PDF_CORRUPTED: "Le PDF est invalide ou protégé.",
  TAKEOFF_PDF_NOT_INTERPRETABLE: "Le PDF est lisible mais reste inexploitable.",
  TAKEOFF_FILE_TOO_LARGE: "Document trop volumineux.",
  AI_SCHEMA: "Extraction incomplète sur ce document.",
  TAKEOFF_LEVEL_C_INVALID_SCHEMA: "Extraction incomplète sur ce document.",
  AI_TIMEOUT: "Délai dépassé.",
  TAKEOFF_LEVEL_C_TIMEOUT: "Délai dépassé.",
  AI_SAFETY: "Document bloqué pendant l'analyse.",
  TAKEOFF_LEVEL_C_BUDGET_EXCEEDED: "L’analyse détaillée dépasse le budget prévu.",
  TAKEOFF_REQUEST_BUDGET_EXHAUSTED: "Le budget de cette analyse était épuisé : ce plan n’a pas été lu en entier.",
  TAKEOFF_USAGE_UNRECORDED: "La consommation d’un appel de cette analyse est restée inconnue ou n’a pas pu être enregistrée : plus aucun appel payant n’est fait pour elle. Relancez les plans à lire.",
  TAKEOFF_PREPARATION_SOURCE_CHANGED: "Ce plan a changé dans le dossier après le lancement : il n’a pas été lu. Relancez-le pour lire sa version actuelle.",
};

export function getTakeoffVisibleJobStatusLabel(
  status: TakeoffVisibleJobStatus
): string {
  return TAKEOFF_VISIBLE_JOB_STATUS_LABELS[status];
}

export function isTakeoffVisibleJobInFlight(
  status: TakeoffVisibleJobStatus | null | undefined
): boolean {
  return status != null && IN_FLIGHT_VISIBLE_STATUS_SET.has(status);
}

export function canLaunchNewTakeoffAnalysis(
  status: TakeoffVisibleJobStatus | null | undefined
): boolean {
  return status == null;
}

export function resolveTakeoffVisibleJobStatus(
  input: ResolveTakeoffVisibleJobStatusInput
): TakeoffVisibleJobStatusDescriptor {
  if (input.status === "pending") {
    return { status: "queued", label: getTakeoffVisibleJobStatusLabel("queued") };
  }

  if (input.status === "processing") {
    if (
      input.processingStrategy === "batch" &&
      input.providerBatchState &&
      PROVIDER_PENDING_STATES.has(input.providerBatchState)
    ) {
      return {
        status: "provider_pending",
        label: getTakeoffVisibleJobStatusLabel("provider_pending"),
      };
    }

    return {
      status: "processing",
      label: getTakeoffVisibleJobStatusLabel("processing"),
    };
  }

  if (input.status === "completed" || input.status === "applied") {
    if (
      input.compareSummaryUnavailable ||
      (input.exceptionCount !== null &&
        input.exceptionCount !== undefined &&
        input.exceptionCount > 0)
    ) {
      return {
        status: "review_required",
        label: getTakeoffVisibleJobStatusLabel("review_required"),
      };
    }

    return {
      status: "completed",
      label: getTakeoffVisibleJobStatusLabel("completed"),
    };
  }

  if (input.status === "failed" || input.status === "canceled") {
    return {
      status: "action_required",
      label: getTakeoffVisibleJobStatusLabel("action_required"),
    };
  }

  return {
    status: "processing",
    label: getTakeoffVisibleJobStatusLabel("processing"),
  };
}

export function getTakeoffFailureReasonLabel(input: {
  errorCode?: string | null;
  fallbackMessage?: string | null;
}): string | null {
  if (input.errorCode) {
    return FAILURE_FACTS[input.errorCode] ?? null;
  }

  if (input.fallbackMessage && input.fallbackMessage.trim().length > 0) {
    return "Analyse interrompue.";
  }

  return null;
}

export function takeoffCompletionFailureReason(code: string | null | undefined) {
  return getTakeoffFailureReasonLabel({ errorCode: code })
    ?? "Le traitement n’a pas pu terminer le métré. Consultez l’activité de l’affaire.";
}

/**
 * What happened to a failed analysis, on its row and in the banner, in French: never its code, which the screen does not
 * show, and never an instruction, which the resume decision gives. An old row without a diagnostic says so; a code this
 * version does not know gets a general reason.
 */
export function describeTakeoffJobFailure(code: string | null | undefined) {
  if (!code) return "Échec sans code disponible.";
  return FAILURE_FACTS[code] ?? "L’analyse a été interrompue pour une raison non répertoriée.";
}
