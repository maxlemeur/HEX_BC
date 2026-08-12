import type { PostgrestError } from "@supabase/supabase-js";

import type { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/estimates/errors";
import type { GeminiBatchLifecycleEvent } from "@/lib/takeoff/gemini-client";
import {
  TAKEOFF_BATCH_RECONCILE_BACKOFF_SECONDS,
} from "@/lib/takeoff/constants";
import { TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import type {
  TakeoffLevel,
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
  processingLeaseToken?: string | null;
  providerReconcileLeaseToken?: string | null;
  nowIso?: string;
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

export function resolveExecutableTakeoffProcessingStrategy(
  level: TakeoffLevel,
  requestedStrategy: TakeoffProcessingStrategy
): TakeoffProcessingStrategy {
  return level === "A" ? requestedStrategy : "sync";
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

export function isTerminalTakeoffProviderBatchState(
  value: TakeoffProviderBatchState | null | undefined
) {
  return (
    value === "succeeded" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "expired"
  );
}

export function getTakeoffBatchReconcileBackoffSeconds(attemptCount: number) {
  if (!Number.isFinite(attemptCount) || attemptCount <= 1) {
    return TAKEOFF_BATCH_RECONCILE_BACKOFF_SECONDS[0];
  }

  const index = Math.max(
    0,
    Math.min(
      TAKEOFF_BATCH_RECONCILE_BACKOFF_SECONDS.length - 1,
      Math.trunc(attemptCount) - 1
    )
  );

  return TAKEOFF_BATCH_RECONCILE_BACKOFF_SECONDS[index];
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

  if (!snapshotChanged && !shouldInsertEvent) {
    return nextSnapshot;
  }

  const fenced = Boolean(
    input.processingLeaseToken || input.providerReconcileLeaseToken
  );
  const { data, error } = await input.supabase.rpc(
    (fenced
      ? "persist_takeoff_provider_batch_snapshot_fenced"
      : "persist_takeoff_provider_batch_snapshot") as never,
    {
      p_job_id: input.jobId,
      p_tenant_id: input.tenantId,
      p_estimate_version_id: input.estimateVersionId,
      p_provider: input.provider,
      p_processing_strategy: nextSnapshot.processing_strategy,
      p_provider_batch_id: nextSnapshot.provider_batch_id,
      p_provider_batch_state: nextSnapshot.provider_batch_state,
      p_provider_batch_updated_at: nextSnapshot.provider_batch_updated_at,
      p_provider_state_raw: nextSnapshot.provider_state_raw,
      p_message: normalizeNullableText(input.message),
      p_metadata: input.metadata ?? {},
      p_should_update_snapshot: snapshotChanged,
      p_should_insert_event: shouldInsertEvent,
      ...(fenced
        ? {
            p_processing_lease_token: input.processingLeaseToken ?? null,
            p_provider_reconcile_lease_token:
              input.providerReconcileLeaseToken ?? null,
            p_now: input.nowIso ?? input.observedAtIso,
          }
        : {}),
    } as never
  );

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(
        error as PostgrestError,
        "Impossible de persister l'etat provider du batch takeoff et son historique."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  if (fenced && data !== true) {
    throw toTakeoffError(
      new Error("Le lease takeoff n'est plus disponible."),
      {
        fallbackCode: TakeoffErrorCode.CONFLICT,
        fallbackMessage: "Le lease takeoff n'est plus disponible.",
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  return nextSnapshot;
}

export async function persistGeminiBatchLifecycleEvent<
  TJob extends ProviderBatchSnapshot & {
    id: string;
    tenant_id: string;
    estimate_version_id: string;
    processing_lease_token: string | null;
    provider_reconcile_lease_token: string | null;
  },
>(input: {
  supabase: Supabase;
  job: TJob;
  event: GeminiBatchLifecycleEvent;
  nowIso: string;
}): Promise<TJob> {
  const providerBatchState = normalizeGeminiProviderBatchState(
    input.event.providerBatchStateRaw
  );
  const snapshot = await persistTakeoffProviderBatchSnapshot({
    supabase: input.supabase,
    jobId: input.job.id,
    tenantId: input.job.tenant_id,
    estimateVersionId: input.job.estimate_version_id,
    provider: "gemini",
    currentSnapshot: input.job,
    processingStrategy: "batch",
    providerBatchId: input.event.providerBatchId,
    providerBatchState,
    providerStateRaw: input.event.providerBatchStateRaw,
    observedAtIso: input.event.observedAt,
    message: input.event.message,
    metadata: {
      provider: input.event.provider,
      is_terminal: input.event.isTerminal,
    },
    processingLeaseToken: input.job.processing_lease_token,
    providerReconcileLeaseToken: input.job.provider_reconcile_lease_token,
    nowIso: input.nowIso,
  });

  return {
    ...input.job,
    processing_strategy: snapshot.processing_strategy,
    provider_batch_id: snapshot.provider_batch_id,
    provider_batch_state: snapshot.provider_batch_state,
    provider_batch_updated_at: snapshot.provider_batch_updated_at,
  };
}
