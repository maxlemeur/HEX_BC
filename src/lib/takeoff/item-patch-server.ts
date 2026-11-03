import "server-only";

import {
  logTakeoffAuditEvent,
  takeoffAuditMetadataBuilders,
} from "@/lib/takeoff/audit";
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
      const updatedItem = normalizeTakeoffItemRow(updated.item);

      await Promise.all(
        plan.auditFields.map((audit) => {
          const context = {
            supabase,
            tenantId,
            userId,
            jobId: normalizedJobId,
            estimateVersionId: jobRow.estimate_version_id,
            tableName: "takeoff_items",
            mode: "non-blocking" as const,
          };
          if (audit.field === "is_excluded" && audit.next === true) {
            return logTakeoffAuditEvent({
              ...context,
              action: "takeoff.item.excluded",
              metadata: takeoffAuditMetadataBuilders["takeoff.item.excluded"]({
                item_id: entry.item_id,
                reason: entry.fields.exclusion_reason ?? null,
              }),
            });
          }

          return logTakeoffAuditEvent({
            ...context,
            action: "takeoff.item.modified",
            metadata: takeoffAuditMetadataBuilders["takeoff.item.modified"]({
              item_id: entry.item_id,
              field: audit.field,
              previous_value: audit.previous,
              next_value: audit.next,
            }),
          });
        })
      );

      results.push({ item_id: entry.item_id, success: true, item: updatedItem });
    } catch {
      results.push({
        item_id: entry.item_id,
        success: false,
        error: "Erreur interne lors de la mise à jour de l'item.",
      });
    }
  }

  // The fixed rules read the quantity, its entry and the exclusion (TI-664): computed again for the version, then
  // the saved lines read back with their results (writing them never moves updated_at).
  const saved = results.flatMap((result) => (result.success ? [result.item_id] : []));
  if (saved.length > 0) {
    const outcome = await recomputeTakeoffRulesQuietly({ tenantId, estimateVersionId: jobRow.estimate_version_id, context: "item_patch" });
    if (outcome && outcome.lines > 0) {
      const fresh = await readTakeoffItemsAfterRules({ supabase, tenantId, jobId: normalizedJobId, itemIds: saved });
      for (const [index, result] of results.entries()) {
        const item = result.success ? fresh.get(result.item_id) : undefined;
        if (item) results[index] = { item_id: result.item_id, success: true, item: normalizeTakeoffItemRow(item) };
      }
    }
  }

  return {
    results,
    succeeded: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
  };
}
