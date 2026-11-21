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

// A new analysis stays detailed: a reason never proposes another level, only fewer sources or a corrected file.
const FAILURE_REASON_LABELS: Record<string, string> = {
  AI_PROVIDER: "Le service d’analyse n’a pas pu terminer le métré.",
  AI_RATE_LIMIT: "Le service d’analyse a refusé temporairement la demande.",
  FORBIDDEN: "L’accès nécessaire au traitement n’est plus disponible.",
  INTERNAL_ERROR: "Une erreur interne a interrompu l’analyse.",
  TAKEOFF_WORKER_NOT_STARTED:
    "L’analyse n’a pas pu démarrer. Vérifiez le poste autorisé avant de préparer une nouvelle analyse.",
  TAKEOFF_WORKER_OUTCOME_UNKNOWN:
    "Le traitement a été interrompu. Son résultat est inconnu et doit être vérifié avant une nouvelle analyse.",
  TAKEOFF_FILE_TYPE_INVALID: "Document non exploitable. Importez un autre document PDF lisible.",
  TAKEOFF_PDF_CORRUPTED:
    "Le PDF est invalide ou protégé. Réexportez-le avant de relancer l'analyse.",
  TAKEOFF_PDF_NOT_INTERPRETABLE:
    "Le PDF est lisible mais reste inexploitable. Importez un PDF mieux exporté ou un autre document.",
  TAKEOFF_FILE_TOO_LARGE:
    "Document trop volumineux. Restreignez les sources ou découpez le document.",
  AI_SCHEMA:
    "Extraction incomplète sur ce document. Restreignez les sources ou importez un document mieux exporté.",
  TAKEOFF_LEVEL_C_INVALID_SCHEMA:
    "Extraction incomplète sur ce document. Restreignez les sources ou importez un document mieux exporté.",
  AI_TIMEOUT:
    "Délai dépassé. Relancez l'analyse ou restreignez les sources.",
  TAKEOFF_LEVEL_C_TIMEOUT:
    "Délai dépassé. Relancez l'analyse ou restreignez les sources.",
  AI_SAFETY:
    "Document bloqué pendant l'analyse. Importez un autre document exploitable.",
  TAKEOFF_LEVEL_C_BUDGET_EXCEEDED:
    "L’analyse détaillée dépasse le budget prévu. Restreignez les sources ou découpez le document.",
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
    return FAILURE_REASON_LABELS[input.errorCode] ?? null;
  }

  if (input.fallbackMessage && input.fallbackMessage.trim().length > 0) {
    return "Analyse interrompue. Relancez l'analyse ou importez un autre document.";
  }

  return null;
}

export function takeoffCompletionFailureReason(code: string | null | undefined) {
  return getTakeoffFailureReasonLabel({ errorCode: code })
    ?? "Le traitement n’a pas pu terminer le métré. Consultez l’activité de l’affaire.";
}

/**
 * The reason of a failed analysis on its row, in French: never its code, which the screen does not show. An old row
 * without a diagnostic says so; a code this version does not know gets a general reason.
 */
export function describeTakeoffJobFailure(code: string | null | undefined) {
  if (!code) return "Échec sans code disponible.";
  return getTakeoffFailureReasonLabel({ errorCode: code }) ?? "L’analyse a été interrompue pour une raison non répertoriée.";
}
