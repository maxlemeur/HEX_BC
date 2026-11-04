import "server-only";

import {
  TAKEOFF_ITEMS_SELECT,
  type AuthenticatedTakeoffContext,
  type TakeoffItemRow,
} from "@/lib/takeoff/job-read-server";
import {
  TAKEOFF_ITEM_CONCURRENCY_ERROR,
  type TakeoffItemPatchUpdate,
} from "@/lib/takeoff/item-patch-preparation";

type TakeoffItemPatchScope = {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  jobId: string;
  itemId: string;
};

type TakeoffItemPatchRowResult =
  | { success: false; error: string }
  | { success: true; item: TakeoffItemRow };

export async function readTakeoffItemForPatch(
  input: TakeoffItemPatchScope
): Promise<TakeoffItemPatchRowResult> {
  const { data, error } = await input.supabase
    .from("takeoff_items" as never)
    .select(TAKEOFF_ITEMS_SELECT as never)
    .eq("id" as never, input.itemId as never)
    .eq("job_id" as never, input.jobId as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .maybeSingle();

  if (error) return { success: false, error: "Impossible de charger l'item." };
  if (!data) return { success: false, error: "Item introuvable." };
  return { success: true, item: data as TakeoffItemRow };
}

const TAKEOFF_ITEM_COLUMNS = TAKEOFF_ITEMS_SELECT.split(",").map((column) => column.trim());

/**
 * Saves one line as it was read (its updated_at), through update_takeoff_item_for_review: the version's lock first,
 * then the line's (TI-677). The rules' peer invalidation locks every other line of the version; two saves that each
 * held their own line first could deadlock. The row comes back with the review's columns (TAKEOFF_ITEMS_SELECT).
 */
export async function updateTakeoffItemWithExpectedTimestamp(
  input: TakeoffItemPatchScope & {
    expectedUpdatedAt: string;
    updatePayload: TakeoffItemPatchUpdate;
  }
): Promise<TakeoffItemPatchRowResult> {
  const { data, error } = await input.supabase.rpc("update_takeoff_item_for_review" as never, {
    p_tenant_id: input.tenantId,
    p_job_id: input.jobId,
    p_item_id: input.itemId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_fields: input.updatePayload,
  } as never);

  if (error) return { success: false, error: "Impossible de mettre à jour l'item." };
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) return { success: false, error: TAKEOFF_ITEM_CONCURRENCY_ERROR };
  return { success: true, item: Object.fromEntries(TAKEOFF_ITEM_COLUMNS.map((column) => [column, row[column]])) as TakeoffItemRow };
}
