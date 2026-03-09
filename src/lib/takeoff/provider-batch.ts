import type { getAuthenticatedContext } from "@/lib/estimates/server";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import type {
  TakeoffProcessingStrategy,
  TakeoffProviderBatchState,
} from "@/lib/takeoff/types";

type Supabase = Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];

type ProviderBatchSnapshot = {
  processing_strategy: TakeoffProcessingStrategy | null;
  provider_batch_id: string | null;
  provider_batch_state: TakeoffProviderBatchState | null;
  provider_batch_updated_at: string | null;
  provider_state_raw?: string | null;
};

type PersistTakeoffProviderBatchSnapshotInput = {
  supabase: Supabase;
  jobId: string;
  tenantId: string;
  estimateVersionId: string;
  provider: "gemini";
  currentSnapshot?: ProviderBatchSnapshot | null;
  processingStrategy: TakeoffProcessingStrategy;
  providerBatchId?: string | null;
  providerBatchState?: TakeoffProviderBatchState | null;
  providerStateRaw?: string | null;
  observedAtIso: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
};

type PersistTakeoffProviderBatchSnapshotResult = {
  processing_strategy: TakeoffProcessingStrategy;
  provider_batch_id: string | null;
  provider_batch_state: TakeoffProviderBatchState | null;
  provider_batch_updated_at: string | null;
  provider_state_raw: string | null;
};

const GEMINI_BATCH_STATE_MAP: Record<string, TakeoffProviderBatchState> = {
  JOB_STATE_SUBMITTED: "submitted",
  JOB_STATE_PENDING: "pending",
  JOB_STATE_RUNNING: "running",
  JOB_STATE_SUCCEEDED: "succeeded",
  JOB_STATE_FAILED: "failed",
  JOB_STATE_CANCELLED: "cancelled",
  JOB_STATE_CANCELED: "cancelled",
  JOB_STATE_EXPIRED: "expired",
};

function normalizeNullableText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveTakeoffProcessingStrategy(useBatchApi: boolean): TakeoffProcessingStrategy {
  return useBatchApi ? "batch" : "sync";
}

export function normalizeTakeoffProcessingStrategy(
  value: unknown
): TakeoffProcessingStrategy | null {
  return value === "sync" || value === "batch" ? value : null;
}

export function normalizeGeminiProviderBatchState(
  value: unknown
): TakeoffProviderBatchState {
  if (typeof value !== "string") {
    return "unknown";
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "unknown";
  }

  if (
    trimmed === "submitted" ||
    trimmed === "pending" ||
    trimmed === "running" ||
    trimmed === "succeeded" ||
    trimmed === "failed" ||
    trimmed === "cancelled" ||
    trimmed === "expired" ||
    trimmed === "unknown"
  ) {
    return trimmed;
  }

  const normalized = trimmed.toUpperCase();
  return GEMINI_BATCH_STATE_MAP[normalized] ?? "unknown";
}

export async function persistTakeoffProviderBatchSnapshot(
  input: PersistTakeoffProviderBatchSnapshotInput
): Promise<PersistTakeoffProviderBatchSnapshotResult> {
  const statePayloadProvided =
    input.providerBatchId !== undefined ||
    input.providerBatchState !== undefined ||
    input.providerStateRaw !== undefined;
  const nextProviderBatchId =
    input.providerBatchId === undefined
      ? input.currentSnapshot?.provider_batch_id ?? null
      : normalizeNullableText(input.providerBatchId);
  const nextProviderStateRaw =
    input.providerStateRaw === undefined
      ? input.currentSnapshot?.provider_state_raw ?? null
      : normalizeNullableText(input.providerStateRaw);
  const nextProviderBatchState =
    input.providerBatchState ?? input.currentSnapshot?.provider_batch_state ?? null;
  const currentSnapshot = input.currentSnapshot ?? null;
  const baseSnapshotChanged =
    currentSnapshot?.processing_strategy !== input.processingStrategy ||
    currentSnapshot?.provider_batch_id !== nextProviderBatchId ||
    currentSnapshot?.provider_batch_state !== nextProviderBatchState ||
    currentSnapshot?.provider_state_raw !== nextProviderStateRaw;
  const nextProviderBatchUpdatedAt =
    statePayloadProvided && baseSnapshotChanged
      ? input.observedAtIso
      : currentSnapshot?.provider_batch_updated_at ?? null;

  const nextSnapshot: PersistTakeoffProviderBatchSnapshotResult = {
    processing_strategy: input.processingStrategy,
    provider_batch_id: nextProviderBatchId,
    provider_batch_state: nextProviderBatchState,
    provider_batch_updated_at: nextProviderBatchUpdatedAt,
    provider_state_raw: nextProviderStateRaw,
  };

  const snapshotChanged =
    currentSnapshot?.processing_strategy !== nextSnapshot.processing_strategy ||
    currentSnapshot?.provider_batch_id !== nextSnapshot.provider_batch_id ||
    currentSnapshot?.provider_batch_state !== nextSnapshot.provider_batch_state ||
    currentSnapshot?.provider_batch_updated_at !== nextSnapshot.provider_batch_updated_at;
  const shouldInsertEvent = baseSnapshotChanged;

  if (snapshotChanged) {
    const { error } = await input.supabase
      .from("takeoff_jobs" as never)
      .update({
        processing_strategy: nextSnapshot.processing_strategy,
        provider_batch_id: nextSnapshot.provider_batch_id,
        provider_batch_state: nextSnapshot.provider_batch_state,
        provider_batch_updated_at: nextSnapshot.provider_batch_updated_at,
      } as never)
      .eq("id" as never, input.jobId as never)
      .eq("tenant_id" as never, input.tenantId as never);

    if (error) {
      throw toTakeoffError(
        mapSupabaseError(
          error,
          "Impossible de persister l'etat provider du batch takeoff."
        ),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
          jobId: input.jobId,
        }
      );
    }
  }

  if (shouldInsertEvent) {
    const { error } = await input.supabase
      .from("takeoff_job_provider_events" as never)
      .insert({
        tenant_id: input.tenantId,
        takeoff_job_id: input.jobId,
        estimate_version_id: input.estimateVersionId,
        provider: input.provider,
        processing_strategy: nextSnapshot.processing_strategy,
        provider_batch_id: nextSnapshot.provider_batch_id,
        provider_batch_state: nextSnapshot.provider_batch_state,
        provider_state_raw: nextSnapshot.provider_state_raw,
        message: normalizeNullableText(input.message),
        metadata: input.metadata ?? {},
      } as never);

    if (error) {
      throw toTakeoffError(
        mapSupabaseError(
          error,
          "Impossible d'historiser l'etat provider du batch takeoff."
        ),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
          jobId: input.jobId,
        }
      );
    }
  }

  return nextSnapshot;
}
