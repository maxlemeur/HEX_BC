import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { drainProcurementStorageCleanupOutbox } from "@/lib/procurement/storage-cleanup-outbox";
import type { Database } from "@/types/database";

type CleanupRow =
  Database["public"]["Tables"]["procurement_storage_cleanup_outbox"]["Row"];

const CLAIMED_CLEANUP: CleanupRow = {
  id: "11111111-1111-4111-8111-111111111111",
  created_at: "2026-08-12T00:00:00.000Z",
  tenant_id: "22222222-2222-4222-8222-222222222222",
  purchase_order_id: "44444444-4444-4444-8444-444444444444",
  bucket_id: "devis",
  storage_path:
    "purchase-orders/44444444-4444-4444-8444-444444444444/document.pdf",
  attempts: 1,
  max_attempts: 10,
  last_attempt_at: "2026-08-12T00:01:00.000Z",
  next_attempt_at: "2026-08-12T00:00:00.000Z",
  lease_token: "33333333-3333-4333-8333-333333333333",
  lease_expires_at: "2026-08-12T00:03:00.000Z",
  last_error: null,
  completed_at: null,
  abandoned_at: null,
};

function createClient(input?: {
  claimedCleanup?: CleanupRow;
  claimError?: { message: string } | null;
  storageError?: { message: string } | null;
  acknowledgementError?: { message: string } | null;
  acknowledgementData?: boolean;
}) {
  const rpc = vi.fn(async (functionName: string) => {
    if (functionName === "claim_procurement_storage_cleanup") {
      return {
        data: input?.claimError ? null : [input?.claimedCleanup ?? CLAIMED_CLEANUP],
        error: input?.claimError ?? null,
      };
    }
    if (
      functionName === "complete_procurement_storage_cleanup" ||
      functionName === "fail_procurement_storage_cleanup"
    ) {
      return {
        data: input?.acknowledgementData ?? true,
        error: input?.acknowledgementError ?? null,
      };
    }
    throw new Error(`Unexpected RPC ${functionName}`);
  });
  const remove = vi.fn().mockResolvedValue({
    data: [],
    error: input?.storageError ?? null,
  });
  const storageFrom = vi.fn().mockReturnValue({ remove });

  return {
    client: {
      rpc,
      storage: { from: storageFrom },
    } as unknown as SupabaseClient<Database>,
    mocks: { rpc, remove, storageFrom },
  };
}

describe("procurement Storage cleanup outbox", () => {
  it("treats an absent object as idempotent success and completes its lease", async () => {
    const { client, mocks } = createClient();

    await expect(
      drainProcurementStorageCleanupOutbox({
        client,
        tenantId: CLAIMED_CLEANUP.tenant_id,
      })
    ).resolves.toEqual({
      claimed: 1,
      removed: 1,
      failed: 0,
      skipped: false,
      errors: [],
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_procurement_storage_cleanup",
      {
        p_tenant_id: CLAIMED_CLEANUP.tenant_id,
        p_limit: 25,
        p_lease_seconds: 120,
      }
    );
    expect(mocks.storageFrom).toHaveBeenCalledWith("devis");
    expect(mocks.remove).toHaveBeenCalledWith([
      "purchase-orders/44444444-4444-4444-8444-444444444444/document.pdf",
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "complete_procurement_storage_cleanup",
      {
        p_cleanup_id: CLAIMED_CLEANUP.id,
        p_lease_token: CLAIMED_CLEANUP.lease_token,
      }
    );
  });

  it("retains failed work with bounded backoff and releases its lease", async () => {
    const { client, mocks } = createClient({
      storageError: { message: "storage unavailable" },
    });

    const result = await drainProcurementStorageCleanupOutbox({ client });

    expect(result).toEqual({
      claimed: 1,
      removed: 0,
      failed: 1,
      skipped: false,
      errors: ["storage unavailable"],
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "fail_procurement_storage_cleanup",
      {
        p_cleanup_id: CLAIMED_CLEANUP.id,
        p_lease_token: CLAIMED_CLEANUP.lease_token,
        p_error: "storage unavailable",
        p_base_delay_seconds: 30,
      }
    );
  });

  it("refuses a claimed path outside its purchase-order namespace", async () => {
    const { client, mocks } = createClient({
      claimedCleanup: {
        ...CLAIMED_CLEANUP,
        storage_path: "signatures/portal-token.png",
      },
    });

    await expect(
      drainProcurementStorageCleanupOutbox({ client })
    ).resolves.toEqual({
      claimed: 1,
      removed: 0,
      failed: 1,
      skipped: false,
      errors: ["Cleanup target is outside its purchase-order namespace."],
    });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "fail_procurement_storage_cleanup",
      expect.objectContaining({
        p_cleanup_id: CLAIMED_CLEANUP.id,
        p_lease_token: CLAIMED_CLEANUP.lease_token,
      })
    );
  });

  it("leaves the durable row retryable when acknowledgement is lost", async () => {
    const { client } = createClient({
      acknowledgementError: { message: "database unavailable" },
      acknowledgementData: false,
    });

    await expect(
      drainProcurementStorageCleanupOutbox({ client })
    ).resolves.toEqual({
      claimed: 1,
      removed: 0,
      failed: 1,
      skipped: false,
      errors: ["database unavailable"],
    });
  });

  it("skips provider work when service-role configuration is unavailable", async () => {
    await expect(
      drainProcurementStorageCleanupOutbox({ client: null })
    ).resolves.toEqual({
      claimed: 0,
      removed: 0,
      failed: 0,
      skipped: true,
      errors: ["Supabase service-role configuration is unavailable."],
    });
  });
});
