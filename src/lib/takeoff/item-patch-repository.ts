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

export async function updateTakeoffItemWithExpectedTimestamp(
  input: TakeoffItemPatchScope & {
    expectedUpdatedAt: string;
    updatePayload: TakeoffItemPatchUpdate;
  }
): Promise<TakeoffItemPatchRowResult> {
  const { data, error } = await input.supabase
    .from("takeoff_items" as never)
    .update(input.updatePayload as never)
    .eq("id" as never, input.itemId as never)
    .eq("job_id" as never, input.jobId as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("updated_at" as never, input.expectedUpdatedAt as never)
    .select(TAKEOFF_ITEMS_SELECT as never)
    .maybeSingle();

  if (error) return { success: false, error: "Impossible de mettre à jour l'item." };
  if (!data) return { success: false, error: TAKEOFF_ITEM_CONCURRENCY_ERROR };
  return { success: true, item: data as TakeoffItemRow };
}
