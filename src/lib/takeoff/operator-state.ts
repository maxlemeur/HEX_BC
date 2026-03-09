import { TAKEOFF_BATCH_RECONCILE_LEASE_TTL_SECONDS } from "@/lib/takeoff/constants";
import type {
  TakeoffJobOperatorState,
  TakeoffJobStatus,
  TakeoffProcessingStrategy,
  TakeoffProviderBatchState,
} from "@/lib/takeoff/types";

const TAKEOFF_OPERATOR_MUTATION_ROLES = new Set(["admin", "engineer"]);

const PROVIDER_PENDING_STATES = new Set<TakeoffProviderBatchState>([
  "submitted",
  "pending",
  "running",
  "unknown",
]);

const PROVIDER_FAILED_STATES = new Set<TakeoffProviderBatchState>([
  "failed",
  "cancelled",
  "expired",
]);
const PROVIDER_TERMINAL_STATES = new Set<TakeoffProviderBatchState>([
  "succeeded",
  ...PROVIDER_FAILED_STATES,
]);
const TAKEOFF_RETRY_MAX = 3;

const TAKEOFF_OPERATOR_STATE_LABELS: Record<TakeoffJobOperatorState, string> = {
  none: "Aucune action requise",
  submitted_to_provider: "Soumis au provider",
  awaiting_provider_result: "En attente du resultat provider",
  provider_failed: "Echec provider",
  orphan_to_reconcile: "Reprise reconcile requise",
};

export type ResolveTakeoffOperatorStateInput = {
  status: TakeoffJobStatus | string;
  processingStrategy?: TakeoffProcessingStrategy | null;
  providerBatchId?: string | null;
  providerBatchState?: TakeoffProviderBatchState | null;
  providerReconcileDueAt?: string | null;
  providerReconcileLeaseExpiresAt?: string | null;
  errorCode?: string | null;
  retryCount?: number | null;
  tenantRole?: string | null;
  now?: Date;
};

export type TakeoffOperatorStateDescriptor = {
  state: TakeoffJobOperatorState;
  label: string;
  canReconcile: boolean;
  canCancel: boolean;
  canResubmit: boolean;
};

export function isTakeoffOperatorMutationRole(
  tenantRole: string | null | undefined
): boolean {
  return tenantRole != null && TAKEOFF_OPERATOR_MUTATION_ROLES.has(tenantRole);
}

export function getTakeoffOperatorStateLabel(
  state: TakeoffJobOperatorState
): string {
  return TAKEOFF_OPERATOR_STATE_LABELS[state];
}

function parseIsoTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function resolveTakeoffOperatorStateValue(
  input: ResolveTakeoffOperatorStateInput
): TakeoffJobOperatorState {
  if (input.processingStrategy !== "batch" || !input.providerBatchId) {
    return "none";
  }

  if (
    input.status === "processing" &&
    input.providerBatchState &&
    PROVIDER_TERMINAL_STATES.has(input.providerBatchState)
  ) {
    return "orphan_to_reconcile";
  }

  if (
    input.status === "failed" &&
    input.providerBatchState === "succeeded"
  ) {
    return "orphan_to_reconcile";
  }

  if (
    input.status === "failed" &&
    input.providerBatchState &&
    PROVIDER_FAILED_STATES.has(input.providerBatchState)
  ) {
    return "provider_failed";
  }

  const providerState = input.providerBatchState;
  if (!providerState || !PROVIDER_PENDING_STATES.has(providerState)) {
    return "none";
  }

  if (input.status === "failed") {
    return "orphan_to_reconcile";
  }

  if (input.status !== "processing") {
    return "none";
  }

  if (providerState === "submitted") {
    return "submitted_to_provider";
  }

  const nowMs = (input.now ?? new Date()).getTime();
  const leaseExpiresAtMs = parseIsoTime(input.providerReconcileLeaseExpiresAt);
  if (leaseExpiresAtMs !== null && leaseExpiresAtMs <= nowMs) {
    return "orphan_to_reconcile";
  }

  const reconcileDueAtMs = parseIsoTime(input.providerReconcileDueAt);
  if (
    reconcileDueAtMs !== null &&
    reconcileDueAtMs + TAKEOFF_BATCH_RECONCILE_LEASE_TTL_SECONDS * 1000 <= nowMs
  ) {
    return "orphan_to_reconcile";
  }

  if (input.errorCode === "AI_TIMEOUT") {
    return "orphan_to_reconcile";
  }

  return "awaiting_provider_result";
}

function hasLiveProviderBatch(input: ResolveTakeoffOperatorStateInput) {
  return (
    input.processingStrategy === "batch" &&
    typeof input.providerBatchId === "string" &&
    input.providerBatchId.length > 0 &&
    (input.providerBatchState == null ||
      !PROVIDER_TERMINAL_STATES.has(input.providerBatchState))
  );
}

export function resolveTakeoffOperatorState(
  input: ResolveTakeoffOperatorStateInput
): TakeoffOperatorStateDescriptor {
  const state = resolveTakeoffOperatorStateValue(input);
  const hasMutationAccess = isTakeoffOperatorMutationRole(input.tenantRole);
  const liveLeaseExpiresAtMs = parseIsoTime(input.providerReconcileLeaseExpiresAt);
  const hasLiveLease =
    liveLeaseExpiresAtMs !== null &&
    liveLeaseExpiresAtMs > (input.now ?? new Date()).getTime();

  return {
    state,
    label: getTakeoffOperatorStateLabel(state),
    canReconcile:
      hasMutationAccess &&
      !hasLiveLease &&
      (state === "submitted_to_provider" ||
        state === "awaiting_provider_result" ||
        state === "orphan_to_reconcile"),
    canCancel:
      hasMutationAccess &&
      (input.status === "pending" || input.status === "processing"),
    canResubmit:
      hasMutationAccess &&
      (input.status === "failed" || input.status === "canceled") &&
      (input.retryCount ?? 0) < TAKEOFF_RETRY_MAX &&
      !hasLiveProviderBatch(input),
  };
}
