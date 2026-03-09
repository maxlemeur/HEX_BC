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
  provider_pending: "En attente provider",
  review_required: "Revue requise",
  action_required: "Echec a corriger",
  completed: "Analyse terminee",
};

const PROVIDER_PENDING_STATES = new Set<TakeoffProviderBatchState>([
  "submitted",
  "pending",
  "running",
]);

const FAILURE_REASON_LABELS: Record<string, string> = {
  TAKEOFF_FILE_TYPE_INVALID: "Document non exploitable. Importez un autre document PDF lisible.",
  TAKEOFF_FILE_TOO_LARGE:
    "Document trop volumineux. Essayez un niveau plus rapide ou decoupez le document.",
  AI_SCHEMA:
    "Extraction incomplete sur ce document. Changez de niveau ou importez un autre document.",
  TAKEOFF_LEVEL_C_INVALID_SCHEMA:
    "Extraction incomplete sur ce document. Changez de niveau ou importez un autre document.",
  AI_TIMEOUT:
    "Delai depasse. Relancez l'analyse ou essayez un niveau plus rapide.",
  TAKEOFF_LEVEL_C_TIMEOUT:
    "Delai depasse. Relancez l'analyse ou essayez un niveau plus rapide.",
  AI_SAFETY:
    "Document bloque pendant l'analyse. Importez un autre document exploitable.",
  TAKEOFF_LEVEL_C_BUDGET_EXCEEDED:
    "Le niveau detaille depasse le budget prevu. Changez de niveau ou ciblez un document plus simple.",
};

export function getTakeoffVisibleJobStatusLabel(
  status: TakeoffVisibleJobStatus
): string {
  return TAKEOFF_VISIBLE_JOB_STATUS_LABELS[status];
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
