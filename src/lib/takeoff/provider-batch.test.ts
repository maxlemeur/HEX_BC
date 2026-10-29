import { beforeEach, describe, expect, it, vi } from "vitest";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { persistTakeoffProviderBatchSnapshot } from "@/lib/takeoff/provider-batch";

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const BATCH_ID = "batches/job-1";
const LEASE_TOKEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RECONCILE_TOKEN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("persistTakeoffProviderBatchSnapshot", () => {
  const rpc = vi.fn();
  const supabase = { rpc };

  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: true, error: null });
  });

  it("uses the fenced RPC and rejects a lost lease", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      persistTakeoffProviderBatchSnapshot({
        supabase: supabase as never,
        jobId: JOB_ID,
        tenantId: TENANT_ID,
        estimateVersionId: VERSION_ID,
        provider: "gemini",
        processingStrategy: "batch",
        providerBatchId: BATCH_ID,
        providerBatchState: "failed",
        observedAtIso: "2026-08-19T10:06:00.000Z",
        processingLeaseToken: LEASE_TOKEN,
        providerReconcileLeaseToken: RECONCILE_TOKEN,
        nowIso: "2026-08-19T10:06:01.000Z",
      }),
    ).rejects.toMatchObject({
      name: "TakeoffError",
      code: TakeoffErrorCode.CONFLICT,
      jobId: JOB_ID,
    } satisfies Partial<TakeoffError>);

    expect(rpc).toHaveBeenCalledWith(
      "persist_takeoff_provider_batch_snapshot_fenced",
      expect.objectContaining({
        p_processing_lease_token: LEASE_TOKEN,
        p_provider_reconcile_lease_token: RECONCILE_TOKEN,
        p_now: "2026-08-19T10:06:01.000Z",
      }),
    );
    consoleErrorSpy.mockRestore();
  });
});
