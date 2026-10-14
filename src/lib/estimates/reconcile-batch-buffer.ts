import type { EstimateBatchIntention } from "@/lib/estimates/batch-intentions";
import type { EstimateBatchResult } from "@/lib/estimates/client";
import type { EstimateItemUpdatePayload } from "@/lib/estimates/editor-items";
import type { BatchOperationInput } from "@/lib/estimates/schemas";
import { canonicalizeEstimateBatchOperations } from "@/lib/estimates/batch-request";

/** Remove only values proven committed; subsequent local edits remain pending. */
export function reconcileEstimateBatchBuffer(
  pending: EstimateBatchIntention,
  result: EstimateBatchResult,
  pendingUpdates: Map<string, EstimateItemUpdatePayload>
) {
  if (!result.committed) return;
  const operations = (JSON.parse(pending.body) as { operations: BatchOperationInput[] }).operations;
  const confirmed = new Map<string, Record<string, unknown>>();
  operations.forEach((operation) => {
    if (operation.op === "update") confirmed.set(operation.id, { ...confirmed.get(operation.id), ...operation.data });
  });
  confirmed.forEach((patch, id) => {
    const remaining = pendingUpdates.get(id);
    if (!remaining) return;
    const canonical = canonicalizeEstimateBatchOperations([{ op: "update", id,
      data: remaining as Extract<BatchOperationInput, { op: "update" }>["data"],
    }])[0];
    if (canonical.op !== "update") return;
    const rest = { ...remaining } as Record<string, unknown>;
    Object.entries(canonical.data).forEach(([key, value]) => {
      if (Object.hasOwn(patch, key) && Object.is(value, patch[key])) delete rest[key];
    });
    if (Object.keys(rest).length) pendingUpdates.set(id, rest);
    else pendingUpdates.delete(id);
  });
  result.results.forEach((entry) => {
    if (entry.status !== "ok" || !entry.data || typeof entry.data !== "object") return;
    const deleted = (entry.data as { deleted_ids?: unknown }).deleted_ids;
    if (Array.isArray(deleted)) deleted.forEach((id) => {
      if (typeof id === "string") pendingUpdates.delete(id);
    });
  });
}
