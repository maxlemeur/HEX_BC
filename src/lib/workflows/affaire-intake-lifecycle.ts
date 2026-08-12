import {
  affaireIntakeUploadStatusSchema,
  type AffaireIntakeUploadStatus,
} from "@/lib/affaires/intake";

const AFFAIRE_INTAKE_LEASE_TTL_MS = 10 * 60 * 1000;
const AFFAIRE_INTAKE_MAX_ATTEMPTS = 3;
const AFFAIRE_INTAKE_RETRY_BACKOFF_SECONDS = [30, 120, 300] as const;

type RpcResult = {
  data: unknown;
  error: unknown;
};

export type DurableWorkflowRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
};

type IntakeClaimRow = {
  claimed: boolean;
  reason: string;
  tenant_id: string | null;
  project_id: string | null;
  upload_status: AffaireIntakeUploadStatus | null;
  attempt_count: number;
};

export type AffaireIntakeClaim = {
  uploadId: string;
  leaseToken: string;
  tenantId: string;
  projectId: string;
  attemptCount: number;
};

export type AffaireIntakeClaimResult =
  | { claimed: true; claim: AffaireIntakeClaim }
  | {
      claimed: false;
      reason: string;
      status: AffaireIntakeUploadStatus | null;
    };

export class AffaireIntakeLeaseUnavailableError extends Error {
  constructor(readonly uploadId: string) {
    super("Le lease de traitement intake n'est plus disponible.");
    this.name = "AffaireIntakeLeaseUnavailableError";
  }
}

export class AffaireIntakeProviderCallError extends Error {
  constructor(cause: unknown) {
    super("L'appel fournisseur intake a echoue.", { cause });
    this.name = "AffaireIntakeProviderCallError";
  }
}

export async function runAffaireIntakeLeasedProviderEffect<T>(input: {
  renewLease: () => Promise<void>;
  effect: () => Promise<T>;
}) {
  await input.renewLease();
  let result: T | undefined;
  let effectFailed = false;
  let effectError: unknown;
  try {
    result = await input.effect();
  } catch (error) {
    effectFailed = true;
    effectError = error;
  }

  // Fence the outcome, including provider failures. If the lease expired and was
  // reclaimed while the provider call was in flight, the stale worker must not
  // persist either a failure marker or a fallback generated from that failure.
  await input.renewLease();
  if (effectFailed) {
    throw new AffaireIntakeProviderCallError(effectError);
  }
  return result as T;
}

function firstRpcRow(data: unknown) {
  if (Array.isArray(data)) {
    return data[0];
  }
  return data;
}

function normalizeClaimRow(data: unknown): IntakeClaimRow | null {
  const row = firstRpcRow(data);
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return null;
  }

  const record = row as Record<string, unknown>;
  const status = affaireIntakeUploadStatusSchema.safeParse(record.upload_status);
  return {
    claimed: record.claimed === true,
    reason: typeof record.reason === "string" ? record.reason : "unknown",
    tenant_id: typeof record.tenant_id === "string" ? record.tenant_id : null,
    project_id: typeof record.project_id === "string" ? record.project_id : null,
    upload_status: status.success ? status.data : null,
    attempt_count:
      typeof record.attempt_count === "number" && Number.isFinite(record.attempt_count)
        ? Math.max(0, Math.trunc(record.attempt_count))
        : 0,
  };
}

function toIsoAfter(now: Date, milliseconds: number) {
  return new Date(now.getTime() + milliseconds).toISOString();
}

export async function claimAffaireIntakeUpload(input: {
  client: DurableWorkflowRpcClient;
  uploadId: string;
  now: Date;
}): Promise<AffaireIntakeClaimResult> {
  const leaseToken = crypto.randomUUID();
  const { data, error } = await input.client.rpc("claim_affaire_intake_upload", {
    p_upload_id: input.uploadId,
    p_lease_token: leaseToken,
    p_now: input.now.toISOString(),
    p_lease_expires_at: toIsoAfter(input.now, AFFAIRE_INTAKE_LEASE_TTL_MS),
    p_max_attempts: AFFAIRE_INTAKE_MAX_ATTEMPTS,
  });

  if (error) {
    throw new Error("Impossible de revendiquer l'upload intake.", { cause: error });
  }

  const row = normalizeClaimRow(data);
  if (!row) {
    throw new Error("Reponse de claim intake invalide.");
  }

  if (!row.claimed) {
    return {
      claimed: false,
      reason: row.reason,
      status: row.upload_status,
    };
  }

  if (!row.tenant_id || !row.project_id) {
    throw new Error("Le claim intake ne contient pas son contexte tenant/projet.");
  }

  return {
    claimed: true,
    claim: {
      uploadId: input.uploadId,
      leaseToken,
      tenantId: row.tenant_id,
      projectId: row.project_id,
      attemptCount: row.attempt_count,
    },
  };
}

export async function renewAffaireIntakeUploadLease(input: {
  client: DurableWorkflowRpcClient;
  claim: AffaireIntakeClaim;
  now: Date;
}) {
  const { data, error } = await input.client.rpc(
    "renew_affaire_intake_upload_lease",
    {
      p_upload_id: input.claim.uploadId,
      p_lease_token: input.claim.leaseToken,
      p_now: input.now.toISOString(),
      p_lease_expires_at: toIsoAfter(input.now, AFFAIRE_INTAKE_LEASE_TTL_MS),
    }
  );

  if (error || data !== true) {
    throw new AffaireIntakeLeaseUnavailableError(input.claim.uploadId);
  }
}

export async function finishAffaireIntakeUploadAttempt(input: {
  client: DurableWorkflowRpcClient;
  claim: AffaireIntakeClaim;
  status: Exclude<AffaireIntakeUploadStatus, "processing">;
  now: Date;
  nextRetryAt?: Date;
  lastError?: string | null;
}) {
  const { data, error } = await input.client.rpc(
    "finish_affaire_intake_upload_attempt",
    {
      p_upload_id: input.claim.uploadId,
      p_lease_token: input.claim.leaseToken,
      p_status: input.status,
      p_now: input.now.toISOString(),
      p_next_retry_at: input.nextRetryAt?.toISOString() ?? null,
      p_last_error: input.lastError ?? null,
    }
  );

  if (error || data !== true) {
    throw new AffaireIntakeLeaseUnavailableError(input.claim.uploadId);
  }
}

export async function releaseAffaireIntakeUploadAfterError(input: {
  client: DurableWorkflowRpcClient;
  claim: AffaireIntakeClaim;
  now: Date;
  error: unknown;
}) {
  const shouldRetry = input.claim.attemptCount < AFFAIRE_INTAKE_MAX_ATTEMPTS;
  const backoffIndex = Math.max(
    0,
    Math.min(
      input.claim.attemptCount - 1,
      AFFAIRE_INTAKE_RETRY_BACKOFF_SECONDS.length - 1
    )
  );
  const message =
    input.error instanceof Error
      ? input.error.message
      : "Le traitement intake a echoue sans detail exploitable.";

  try {
    await finishAffaireIntakeUploadAttempt({
      client: input.client,
      claim: input.claim,
      status: shouldRetry ? "queued" : "failed",
      now: input.now,
      nextRetryAt: shouldRetry
        ? new Date(
            input.now.getTime() +
              AFFAIRE_INTAKE_RETRY_BACKOFF_SECONDS[backoffIndex] * 1000
          )
        : undefined,
      lastError: message,
    });
    return true;
  } catch {
    return false;
  }
}
