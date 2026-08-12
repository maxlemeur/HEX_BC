import type { SupabaseClient } from "@supabase/supabase-js";

import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/types/database";

type ServiceRoleClient = SupabaseClient<Database>;
type CleanupRow =
  Database["public"]["Tables"]["procurement_storage_cleanup_outbox"]["Row"];

export type ProcurementStorageCleanupDrainResult = {
  claimed: number;
  removed: number;
  failed: number;
  skipped: boolean;
  errors: string[];
};

type DrainProcurementStorageCleanupInput = {
  tenantId?: string | null;
  limit?: number;
  leaseSeconds?: number;
  client?: ServiceRoleClient | null;
};

const DEFAULT_LIMIT = 25;
const DEFAULT_LEASE_SECONDS = 120;

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

function requireLeaseToken(cleanup: CleanupRow) {
  if (!cleanup.lease_token) {
    throw new Error("Cleanup claim returned without a lease token.");
  }
  return cleanup.lease_token;
}

function assertCanonicalCleanupTarget(cleanup: CleanupRow) {
  const prefix = `purchase-orders/${cleanup.purchase_order_id}/`;
  const filename = cleanup.storage_path.startsWith(prefix)
    ? cleanup.storage_path.slice(prefix.length)
    : "";
  if (
    cleanup.bucket_id !== "devis" ||
    !filename ||
    filename.includes("/") ||
    filename === "." ||
    filename === ".."
  ) {
    throw new Error("Cleanup target is outside its purchase-order namespace.");
  }
}

/**
 * Drains durable cleanup work with a service-role client. Storage removal is
 * idempotent: if deletion succeeds but acknowledgement fails, an expired lease
 * safely retries the same path later.
 */
export async function drainProcurementStorageCleanupOutbox(
  input: DrainProcurementStorageCleanupInput = {}
): Promise<ProcurementStorageCleanupDrainResult> {
  const client =
    input.client === undefined ? createOptionalServiceRoleClient() : input.client;
  if (!client) {
    return {
      claimed: 0,
      removed: 0,
      failed: 0,
      skipped: true,
      errors: ["Supabase service-role configuration is unavailable."],
    };
  }

  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, 100));
  const leaseSeconds = Math.max(
    30,
    Math.min(input.leaseSeconds ?? DEFAULT_LEASE_SECONDS, 600)
  );
  const { data, error: claimError } = await client.rpc(
    "claim_procurement_storage_cleanup",
    {
      p_tenant_id: input.tenantId ?? null,
      p_limit: limit,
      p_lease_seconds: leaseSeconds,
    }
  );

  if (claimError) {
    return {
      claimed: 0,
      removed: 0,
      failed: 0,
      skipped: false,
      errors: [claimError.message],
    };
  }

  const cleanups = data ?? [];
  let removed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const cleanup of cleanups) {
    let storageError: unknown = null;
    try {
      assertCanonicalCleanupTarget(cleanup);
      const removal = await client.storage
        .from(cleanup.bucket_id)
        .remove([cleanup.storage_path]);
      storageError = removal.error;
    } catch (error) {
      storageError = error;
    }

    if (storageError) {
      failed += 1;
      const message = errorMessage(storageError).slice(0, 2000);
      let failureError: unknown = null;
      let requeued = false;
      try {
        const failure = await client.rpc("fail_procurement_storage_cleanup", {
          p_cleanup_id: cleanup.id,
          p_lease_token: requireLeaseToken(cleanup),
          p_error: message,
          p_base_delay_seconds: 30,
        });
        failureError = failure.error;
        requeued = failure.data === true;
      } catch (error) {
        failureError = error;
      }
      errors.push(
        failureError
          ? `${message}; persistence: ${errorMessage(failureError)}`
          : requeued
            ? message
            : `${message}; persistence: cleanup lease was lost`
      );
      continue;
    }

    let completionError: unknown = null;
    let completed = false;
    try {
      const completion = await client.rpc(
        "complete_procurement_storage_cleanup",
        {
          p_cleanup_id: cleanup.id,
          p_lease_token: requireLeaseToken(cleanup),
        }
      );
      completionError = completion.error;
      completed = completion.data === true;
    } catch (error) {
      completionError = error;
    }

    if (completionError || !completed) {
      failed += 1;
      errors.push(
        completionError
          ? errorMessage(completionError)
          : "Cleanup acknowledgement lost its lease."
      );
      continue;
    }

    removed += 1;
  }

  return {
    claimed: cleanups.length,
    removed,
    failed,
    skipped: false,
    errors,
  };
}
