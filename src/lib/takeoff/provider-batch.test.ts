import { beforeEach, describe, expect, it, vi } from "vitest";

import { TAKEOFF_BATCH_RECONCILE_BACKOFF_SECONDS } from "@/lib/takeoff/constants";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import {
  getTakeoffBatchReconcileBackoffSeconds,
  isTerminalTakeoffProviderBatchState,
  normalizeGeminiProviderBatchState,
  normalizeTakeoffProcessingStrategy,
  persistGeminiBatchLifecycleEvent,
  persistTakeoffProviderBatchSnapshot,
  resolveExecutableTakeoffProcessingStrategy,
  resolveTakeoffProcessingStrategy,
} from "@/lib/takeoff/provider-batch";

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const BATCH_ID = "batches/job-1";
const LEASE_TOKEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RECONCILE_TOKEN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("takeoff provider batch strategy and state", () => {
  it("keeps batch only for level A and normalizes provider states", () => {
    expect(resolveTakeoffProcessingStrategy(true)).toBe("batch");
    expect(resolveTakeoffProcessingStrategy(false)).toBe("sync");
    expect(resolveExecutableTakeoffProcessingStrategy("A", "batch")).toBe(
      "batch",
    );
    expect(resolveExecutableTakeoffProcessingStrategy("B", "batch")).toBe(
      "sync",
    );
    expect(resolveExecutableTakeoffProcessingStrategy("C", "sync")).toBe(
      "sync",
    );
    expect(normalizeTakeoffProcessingStrategy("batch")).toBe("batch");
    expect(normalizeTakeoffProcessingStrategy("other")).toBeNull();
    expect(normalizeGeminiProviderBatchState("JOB_STATE_SUCCEEDED")).toBe(
      "succeeded",
    );
    expect(normalizeGeminiProviderBatchState("JOB_STATE_CANCELED")).toBe(
      "cancelled",
    );
    expect(normalizeGeminiProviderBatchState("running")).toBe("running");
    expect(normalizeGeminiProviderBatchState("")).toBe("unknown");
    expect(isTerminalTakeoffProviderBatchState("succeeded")).toBe(true);
    expect(isTerminalTakeoffProviderBatchState("running")).toBe(false);
  });

  it("aggregates reconcile backoff by attempt count", () => {
    expect(getTakeoffBatchReconcileBackoffSeconds(1)).toBe(
      TAKEOFF_BATCH_RECONCILE_BACKOFF_SECONDS[0],
    );
    expect(getTakeoffBatchReconcileBackoffSeconds(2)).toBe(
      TAKEOFF_BATCH_RECONCILE_BACKOFF_SECONDS[1],
    );
    expect(getTakeoffBatchReconcileBackoffSeconds(3)).toBe(
      TAKEOFF_BATCH_RECONCILE_BACKOFF_SECONDS[2],
    );
    expect(getTakeoffBatchReconcileBackoffSeconds(99)).toBe(
      TAKEOFF_BATCH_RECONCILE_BACKOFF_SECONDS[3],
    );
  });
});

describe("persistTakeoffProviderBatchSnapshot", () => {
  const rpc = vi.fn();
  const supabase = { rpc };

  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: true, error: null });
  });

  it("skips persistence when the aggregated snapshot is unchanged", async () => {
    const currentSnapshot = {
      processing_strategy: "batch" as const,
      provider_batch_id: BATCH_ID,
      provider_batch_state: "running" as const,
      provider_batch_updated_at: "2026-08-19T10:00:00.000Z",
      provider_state_raw: "JOB_STATE_RUNNING",
    };

    await expect(
      persistTakeoffProviderBatchSnapshot({
        supabase: supabase as never,
        jobId: JOB_ID,
        tenantId: TENANT_ID,
        estimateVersionId: VERSION_ID,
        provider: "gemini",
        currentSnapshot,
        processingStrategy: "batch",
        observedAtIso: "2026-08-19T10:05:00.000Z",
      }),
    ).resolves.toEqual({
      processing_strategy: "batch",
      provider_batch_id: BATCH_ID,
      provider_batch_state: "running",
      provider_batch_updated_at: "2026-08-19T10:00:00.000Z",
      provider_state_raw: "JOB_STATE_RUNNING",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("persists a changed snapshot through the unfenced RPC", async () => {
    const snapshot = await persistTakeoffProviderBatchSnapshot({
      supabase: supabase as never,
      jobId: JOB_ID,
      tenantId: TENANT_ID,
      estimateVersionId: VERSION_ID,
      provider: "gemini",
      currentSnapshot: {
        processing_strategy: "batch",
        provider_batch_id: BATCH_ID,
        provider_batch_state: "submitted",
        provider_batch_updated_at: "2026-08-19T10:00:00.000Z",
        provider_state_raw: "JOB_STATE_SUBMITTED",
      },
      processingStrategy: "batch",
      providerBatchId: BATCH_ID,
      providerBatchState: "running",
      providerStateRaw: "JOB_STATE_RUNNING",
      observedAtIso: "2026-08-19T10:05:00.000Z",
      message: "provider running",
      metadata: { attempt: 2 },
    });

    expect(snapshot).toEqual({
      processing_strategy: "batch",
      provider_batch_id: BATCH_ID,
      provider_batch_state: "running",
      provider_batch_updated_at: "2026-08-19T10:05:00.000Z",
      provider_state_raw: "JOB_STATE_RUNNING",
    });
    expect(rpc).toHaveBeenCalledWith(
      "persist_takeoff_provider_batch_snapshot",
      expect.objectContaining({
        p_job_id: JOB_ID,
        p_provider_batch_state: "running",
        p_provider_batch_updated_at: "2026-08-19T10:05:00.000Z",
        p_should_update_snapshot: true,
        p_should_insert_event: true,
        p_message: "provider running",
        p_metadata: { attempt: 2 },
      }),
    );
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

describe("persistGeminiBatchLifecycleEvent", () => {
  it("aggregates a provider lifecycle event onto the job snapshot", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const job = {
      id: JOB_ID,
      tenant_id: TENANT_ID,
      estimate_version_id: VERSION_ID,
      processing_strategy: "batch" as const,
      provider_batch_id: BATCH_ID,
      provider_batch_state: "running" as const,
      provider_batch_updated_at: "2026-08-19T10:00:00.000Z",
      processing_lease_token: LEASE_TOKEN,
      provider_reconcile_lease_token: RECONCILE_TOKEN,
    };

    const nextJob = await persistGeminiBatchLifecycleEvent({
      supabase: { rpc } as never,
      job,
      event: {
        provider: "gemini",
        providerBatchId: BATCH_ID,
        providerBatchStateRaw: "JOB_STATE_SUCCEEDED",
        observedAt: "2026-08-19T10:10:00.000Z",
        isTerminal: true,
        message: "batch complete",
      },
      nowIso: "2026-08-19T10:10:01.000Z",
    });

    expect(nextJob).toMatchObject({
      id: JOB_ID,
      processing_strategy: "batch",
      provider_batch_id: BATCH_ID,
      provider_batch_state: "succeeded",
      provider_batch_updated_at: "2026-08-19T10:10:00.000Z",
    });
    expect(rpc).toHaveBeenCalledWith(
      "persist_takeoff_provider_batch_snapshot_fenced",
      expect.objectContaining({
        p_provider_batch_state: "succeeded",
        p_provider_state_raw: "JOB_STATE_SUCCEEDED",
        p_message: "batch complete",
        p_metadata: { provider: "gemini", is_terminal: true },
        p_should_update_snapshot: true,
        p_should_insert_event: true,
      }),
    );
  });
});
