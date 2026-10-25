import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/types/database";

// Weekly purge of the test tenants' old drafts on the shared base
// (public.purge_test_tenant_drafts, supabase/README.md "Données de test").
// Only counters leave this module: project and tenant ids stay in the database.
// Each call stops after 4 s in SQL, under the 8 s API statement timeout; small
// delete batches keep that stop rare, and the run stays within the route's 300 s.
export const TEST_DATA_PURGE_BATCH_SIZE = 25;
export const TEST_DATA_PURGE_DRY_RUN_LIMIT = 1000;
export const TEST_DATA_PURGE_BUDGET_MS = 240_000;

export type TestDataPurgeResult = {
  dryRun: boolean;
  eligible: number;
  deleted: number;
  /** Distinct affaires whose delete failed; they are picked again by the next run. */
  failed: number;
  /** True when the run stopped with affaires possibly left to purge. */
  remaining: boolean;
};

type PurgeRow = Database["public"]["Functions"]["purge_test_tenant_drafts"]["Returns"][number];

export async function purgeTestTenantDrafts(input: {
  dryRun: boolean;
  client?: SupabaseClient<Database>;
  now?: () => number;
}): Promise<TestDataPurgeResult> {
  const client = input.client ?? createServiceRoleClient();
  const now = input.now ?? Date.now;

  async function callPurge(limit: number): Promise<PurgeRow[]> {
    const { data, error } = await client.rpc("purge_test_tenant_drafts", {
      p_dry_run: input.dryRun,
      p_limit: limit,
    });
    if (error) {
      throw new Error("The test data purge RPC failed.", { cause: error });
    }
    return data ?? [];
  }

  if (input.dryRun) {
    const rows = await callPurge(TEST_DATA_PURGE_DRY_RUN_LIMIT);
    return {
      dryRun: true,
      eligible: rows.length,
      deleted: 0,
      failed: 0,
      remaining: rows.length === TEST_DATA_PURGE_DRY_RUN_LIMIT,
    };
  }

  const startedAt = now();
  const failedProjects = new Set<string>();
  let deleted = 0;
  while (now() - startedAt < TEST_DATA_PURGE_BUDGET_MS) {
    const rows = await callPurge(TEST_DATA_PURGE_BATCH_SIZE);
    let deletedInBatch = 0;
    for (const row of rows) {
      if (row.outcome === "deleted") deletedInBatch += 1;
      else failedProjects.add(row.project_id);
    }
    deleted += deletedInBatch;

    // A batch that deleted nothing would select the same failing affaires again.
    if (deletedInBatch === 0) {
      return {
        dryRun: false,
        eligible: 0,
        deleted,
        failed: failedProjects.size,
        remaining: rows.length === TEST_DATA_PURGE_BATCH_SIZE,
      };
    }
  }

  return { dryRun: false, eligible: 0, deleted, failed: failedProjects.size, remaining: true };
}
