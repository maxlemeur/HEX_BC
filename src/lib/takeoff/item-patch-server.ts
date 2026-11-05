import "server-only";

import { readAllRows } from "@/lib/supabase/read-all";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import {
  getAuthenticatedTakeoffContext,
  getTakeoffJobDetailByIdOrThrow,
  normalizeTakeoffItemRow,
  TAKEOFF_ITEMS_SELECT,
} from "@/lib/takeoff/job-read-server";
import { recomputeTakeoffRulesQuietly } from "@/lib/takeoff/rules/recompute-server";
import {
  prepareTakeoffItemPatch,
  takeoffItemBatchPatchSchema,
} from "@/lib/takeoff/item-patch-preparation";
import {
  readTakeoffItemForPatch,
  updateTakeoffItemWithExpectedTimestamp,
} from "@/lib/takeoff/item-patch-repository";
import {
  TAKEOFF_ITEM_RULE_STATES_MAX,
  takeoffItemRuleStateSchema,
  type TakeoffItemRuleState,
} from "@/lib/takeoff/item-response-contracts";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import {
  assertTakeoffOperatorActionRole,
  parseWithSchema,
} from "@/lib/takeoff/server-helpers";
import type {
  TakeoffItemBatchPatchResponse,
  TakeoffItemPatchResult,
} from "@/lib/takeoff/types";

export { takeoffItemBatchPatchSchema } from "@/lib/takeoff/item-patch-preparation";


/** The saved lines as they stand after the rules ran; a line that cannot be read back keeps its saved answer. */
async function readTakeoffItemsAfterRules(input: {
  supabase: Awaited<ReturnType<typeof getAuthenticatedTakeoffContext>>["supabase"];
  tenantId: string;
  jobId: string;
  itemIds: readonly string[];
}) {
  const { data, error } = await input.supabase.from("takeoff_items" as never).select(TAKEOFF_ITEMS_SELECT as never)
    .eq("tenant_id" as never, input.tenantId as never).eq("job_id" as never, input.jobId as never).in("id" as never, input.itemIds as never);
  if (error) return new Map<string, unknown>();
  return new Map(((data ?? []) as Array<{ id: string }>).map((row) => [row.id, row as unknown]));
}

/**
 * The rule state of every line of the job the rules read (evaluated, or stale awaiting the server), read after the
 * computation: the lines whose rules read the saved ones moved with them (TI-664 L5c). Null when it cannot be read
 * whole (an error, an unreadable result, more than TAKEOFF_ITEM_RULE_STATES_MAX lines): the review then keeps what
 * it has, and the apply guard still decides on the stored state.
 */
async function readTakeoffRuleStates(input: {
  supabase: Awaited<ReturnType<typeof getAuthenticatedTakeoffContext>>["supabase"];
  tenantId: string;
  jobId: string;
}): Promise<TakeoffItemRuleState[] | null> {
  type Row = { id: string; rule_results: unknown; rules_evaluated_at: string | null; rules_stale: boolean };
  let rows: Row[];
  try {
    // Every page, checked against the exact count (a short page of the server's max_rows never ends the read).
    const { data, error } = await readAllRows(() => input.supabase.from("takeoff_items" as never)
      .select("id, rule_results, rules_evaluated_at, rules_stale" as never, { count: "exact" })
      .eq("tenant_id" as never, input.tenantId as never).eq("job_id" as never, input.jobId as never) as never);
    if (error || !Array.isArray(data)) return null;
    rows = data as Row[];
  } catch {
    return null;
  }
  const states: TakeoffItemRuleState[] = [];
  for (const row of rows) {
    if (row.rules_evaluated_at === null && row.rules_stale !== true) continue;
    const state = takeoffItemRuleStateSchema.safeParse({ item_id: row.id, rule_results: row.rule_results,
      rules_evaluated_at: row.rules_evaluated_at, rules_stale: row.rules_stale === true });
    if (!state.success) return null;
    states.push(state.data);
  }
  return states.length > TAKEOFF_ITEM_RULE_STATES_MAX ? null : states;
}

export async function batchUpdateTakeoffItems(
  jobId: string,
  body: unknown
): Promise<TakeoffItemBatchPatchResponse> {
  const { supabase, tenantId, userId, tenantRole } =
    await getAuthenticatedTakeoffContext();
  assertTakeoffOperatorActionRole(tenantRole);
  const normalizedJobId = parseWithSchema(
    takeoffJobIdSchema,
    jobId,
    "Identifiant job invalide."
  );
  const request = parseWithSchema(
    takeoffItemBatchPatchSchema,
    body,
    "Payload de mise à jour invalide."
  );
  const jobRow = await getTakeoffJobDetailByIdOrThrow({
    supabase,
    tenantId,
    jobId: normalizedJobId,
  });

  if (jobRow.status !== "completed") {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Le job doit être en statut completed pour modifier les items.",
      details: {
        current_status: jobRow.status,
        allowed_statuses: ["completed"],
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const results: TakeoffItemPatchResult[] = [];
  for (const entry of request.items) {
    try {
      const scope = { supabase, tenantId, jobId: normalizedJobId, itemId: entry.item_id };
      const current = await readTakeoffItemForPatch(scope);
      if (!current.success) {
        results.push({ item_id: entry.item_id, success: false, error: current.error });
        continue;
      }

      const plan = prepareTakeoffItemPatch({
        currentItem: current.item,
        entry,
        level: jobRow.level,
        userId,
        updatedAt: new Date().toISOString(),
      });
      if (!plan.success) {
        results.push({ item_id: entry.item_id, success: false, error: plan.error });
        continue;
      }

      const updated = await updateTakeoffItemWithExpectedTimestamp({
        ...scope,
        expectedUpdatedAt: entry.updated_at,
        updatePayload: plan.updatePayload,
      });
      if (!updated.success) {
        results.push({ item_id: entry.item_id, success: false, error: updated.error });
        continue;
      }
      // The database journaled each change with the save (audit_takeoff_item_decisions, TI-677 PR D): a save never
      // succeeds without its trace.
      const updatedItem = normalizeTakeoffItemRow(updated.item);
      results.push({ item_id: entry.item_id, success: true, item: updatedItem });
    } catch {
      results.push({
        item_id: entry.item_id,
        success: false,
        error: "Erreur interne lors de la mise à jour de l'item.",
      });
    }
  }

  // The fixed rules read the quantity, its entry, the exclusion and the page (TI-664): computed again for the version, then
  // the saved lines read back with their results (writing them never moves updated_at).
  const saved = results.flatMap((result) => (result.success ? [result.item_id] : []));
  let ruleStates: TakeoffItemRuleState[] | null = null;
  if (saved.length > 0) {
    const outcome = await recomputeTakeoffRulesQuietly({ tenantId, estimateVersionId: jobRow.estimate_version_id, context: "item_patch" });
    if (outcome && outcome.lines > 0) {
      const fresh = await readTakeoffItemsAfterRules({ supabase, tenantId, jobId: normalizedJobId, itemIds: saved });
      for (const [index, result] of results.entries()) {
        const item = result.success ? fresh.get(result.item_id) : undefined;
        if (item) results[index] = { item_id: result.item_id, success: true, item: normalizeTakeoffItemRow(item) };
      }
    }
    // The partners of the saved lines too, whether the computation ran or not (a failed one leaves them stale). A
    // version no rule reads (outcome.lines 0) has no rule state to read.
    if (!outcome || outcome.lines > 0) {
      ruleStates = await readTakeoffRuleStates({ supabase, tenantId, jobId: normalizedJobId });
    }
  }

  return {
    results,
    succeeded: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
    ...(ruleStates ? { rule_states: ruleStates } : {}),
  };
}
