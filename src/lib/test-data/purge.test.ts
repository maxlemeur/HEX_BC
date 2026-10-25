import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  TEST_DATA_PURGE_BATCH_SIZE,
  TEST_DATA_PURGE_BUDGET_MS,
  TEST_DATA_PURGE_DRY_RUN_LIMIT,
  purgeTestTenantDrafts,
} from "@/lib/test-data/purge";
import type { Database } from "@/types/database";

type Outcome = "eligible" | "deleted" | "failed";

function rows(outcomes: Outcome[], firstId = 0) {
  return outcomes.map((outcome, index) => ({
    tenant_id: "a8d1292a-0000-4000-8000-000000000001",
    project_id: `00000000-0000-4000-8000-${String(firstId + index).padStart(12, "0")}`,
    outcome,
  }));
}

function clientReturning(...batches: Array<{ data: ReturnType<typeof rows> | null; error?: unknown }>) {
  const rpc = vi.fn();
  for (const batch of batches) rpc.mockResolvedValueOnce({ data: batch.data, error: batch.error ?? null });
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

const batchOf = (outcome: Outcome, size = TEST_DATA_PURGE_BATCH_SIZE) => rows(Array(size).fill(outcome));

describe("purgeTestTenantDrafts", () => {
  it("lists in one call on a dry run", async () => {
    const { client, rpc } = clientReturning({ data: rows(["eligible", "eligible"]) });

    await expect(purgeTestTenantDrafts({ dryRun: true, client })).resolves.toEqual({
      dryRun: true, eligible: 2, deleted: 0, failed: 0, remaining: false,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("purge_test_tenant_drafts", {
      p_dry_run: true, p_limit: TEST_DATA_PURGE_DRY_RUN_LIMIT,
    });

    const listing = clientReturning({ data: batchOf("eligible", TEST_DATA_PURGE_DRY_RUN_LIMIT) });
    await expect(purgeTestTenantDrafts({ dryRun: true, client: listing.client })).resolves.toMatchObject({
      eligible: TEST_DATA_PURGE_DRY_RUN_LIMIT, remaining: true,
    });
  });

  it("deletes in small batches until a batch deletes nothing", async () => {
    // A short batch can still leave affaires behind: the SQL call stops after 4 s.
    const { client, rpc } = clientReturning(
      { data: batchOf("deleted") },
      { data: rows(["deleted", "deleted"]) },
      { data: [] },
    );

    await expect(purgeTestTenantDrafts({ dryRun: false, client })).resolves.toEqual({
      dryRun: false, eligible: 0, deleted: TEST_DATA_PURGE_BATCH_SIZE + 2, failed: 0, remaining: false,
    });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenLastCalledWith("purge_test_tenant_drafts", {
      p_dry_run: false, p_limit: TEST_DATA_PURGE_BATCH_SIZE,
    });
  });

  it("counts an affaire that keeps failing once and stops when only failures are left", async () => {
    const stuck = rows(["failed"]);
    const { client, rpc } = clientReturning(
      { data: [...stuck, ...rows(["deleted", "deleted"], 1)] },
      { data: stuck },
    );

    await expect(purgeTestTenantDrafts({ dryRun: false, client })).resolves.toEqual({
      dryRun: false, eligible: 0, deleted: 2, failed: 1, remaining: false,
    });
    expect(rpc).toHaveBeenCalledTimes(2);

    const blocked = clientReturning({ data: batchOf("failed") });
    await expect(purgeTestTenantDrafts({ dryRun: false, client: blocked.client })).resolves.toMatchObject({
      deleted: 0, failed: TEST_DATA_PURGE_BATCH_SIZE, remaining: true,
    });
  });

  it("stops on its time budget with affaires left", async () => {
    let clock = 0;
    const rpc = vi.fn(async () => {
      clock += TEST_DATA_PURGE_BUDGET_MS / 2;
      return { data: batchOf("deleted"), error: null };
    });
    const client = { rpc } as unknown as SupabaseClient<Database>;

    await expect(purgeTestTenantDrafts({ dryRun: false, client, now: () => clock })).resolves.toEqual({
      dryRun: false, eligible: 0, deleted: TEST_DATA_PURGE_BATCH_SIZE * 2, failed: 0, remaining: true,
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("fails on an RPC error", async () => {
    const { client } = clientReturning({ data: null, error: { message: "permission denied" } });

    await expect(purgeTestTenantDrafts({ dryRun: false, client })).rejects.toThrow("The test data purge RPC failed.");
  });
});
